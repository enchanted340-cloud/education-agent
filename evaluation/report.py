"""Read saved evaluation materials and validate the provenance of supplied findings."""

import hashlib
import json
import re

from profiling.run_store import fingerprint


VERDICTS = {'defect', 'supported_within_scope', 'unresolved'}


def find_record(records, key, value):
    matches = [row for row in records if row[key] == value]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one {key}={value}')
    return matches[0]


def prepare_view(case, view_id):
    view = find_record(case['views'], 'view_id', view_id)
    return {
        'case_id': case['case_id'],
        'view_id': view_id,
        'kind': view['kind'],
        'instruction': view['instruction'],
        'materials': {mid: case['materials'][mid] for mid in view['material_ids']},
    }


def resolve_pointer(value, pointer):
    if pointer and not pointer.startswith('/'):
        raise ValueError(f'Invalid JSON Pointer: {pointer}')
    for token in pointer.split('/')[1:]:
        if re.search(r'~(?![01])', token):
            raise ValueError(f'Invalid JSON Pointer: {pointer}')
        key = token.replace('~1', '/').replace('~0', '~')
        if isinstance(value, list):
            if not re.fullmatch(r'0|[1-9][0-9]*', key):
                raise ValueError(f'Invalid array index in JSON Pointer: {pointer}')
            key = int(key)
        value = value[key]
    return value


def question_binding(review, source_digest, expected_digest):
    if review.get('question_sha256') != expected_digest or source_digest != expected_digest:
        raise ValueError('Review question version mismatch')
    return expected_digest


def digest_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def build_report(bundle, references, notes, root, bundle_hashes):
    if not bundle['set_id'] == references['set_id'] == notes['set_id']:
        raise ValueError('Evaluation set ID mismatch')
    if notes.get('cases_sha256', bundle_hashes['cases']) != bundle_hashes['cases']:
        raise ValueError('Findings refer to a different case file')
    case = find_record(bundle['cases'], 'case_id', notes['case_id'])
    ref = find_record(references['cases'], 'case_id', notes['case_id'])
    views = {v['view_id']: v for v in case['views']}
    selected = notes['view_ids']
    if not selected or len(selected) != len(set(selected)) or set(selected) - views.keys():
        raise ValueError('Select unique views from this case')
    allowed = {vid: set(views[vid]['material_ids']) for vid in selected}
    source_cache = {}

    def source(path):
        if path not in source_cache:
            local = (root / path).resolve()
            if not local.is_relative_to(root.resolve()):
                raise ValueError(f'Source outside source root: {path}')
            raw = local.read_bytes()
            if digest_bytes(raw) != references['source_files'][path]['sha256']:
                raise ValueError(f'Source SHA-256 mismatch: {path}')
            source_cache[path] = json.loads(raw)
        return source_cache[path]

    used = set().union(*allowed.values())
    materials = {}
    for mid in sorted(used):
        loc = ref['source_locators'][mid]
        materials[mid] = {'source': loc, 'model_metadata': ref.get('source_metadata', {}).get(mid)}
        if 'path' in loc:
            raw = resolve_pointer(source(loc['path']), loc['json_pointer'])
            fields = loc.get('fields')
            excerpt = {key: raw[key] for key in fields if key in raw} if fields is not None else raw
            if fingerprint(excerpt) != fingerprint(case['materials'][mid]):
                raise ValueError(f'Saved excerpt mismatch: {mid}')
            materials[mid]['source_sha256'] = references['source_files'][loc['path']]['sha256']
        value = case['materials'][mid]
        if isinstance(value, dict):
            for key in ('record_id', 'evidence_id', 'problem_id'):
                if key in value:
                    materials[mid][key] = value[key]

    versions = {}
    costs = []
    source_status = None
    if 'recorded_run' in ref:
        run_path = ref['recorded_run']['path']
        run = source(run_path)
        source_status = {key: run.get(key) for key in
                         ('run_id', 'status', 'ready_for_student', 'execution_check')}
        costs.append({'source': run_path, 'run_id': run.get('run_id'),
                      'requests_reserved': run.get('requests_reserved'), 'tokens': None,
                      'cost': None, 'reason': '此报告输入未提供可核对的完整用量及费用回执'})
        for index, version in enumerate(run['versions'], 1):
            question = version['question']
            digest = fingerprint(question)
            qid, rid = f'q{index}', f'review{index}'
            if question.get('outcome') == 'needs_split':
                reason = question.get('reason')
                if (run['status'] != 'needs_split' or index != len(run['versions'])
                        or version['version'] != index or not isinstance(reason, str) or not reason.strip()
                        or version.get('review') is not None or rid in used
                        or version.get('question_sha256', digest) != digest):
                    raise ValueError(f'Invalid split decision at version {index}')
                source_status['split_decision'] = {
                    'version': index, 'reason': reason, 'source': run_path,
                    'json_pointer': f'/versions/{index - 1}/question',
                }
                continue
            if digest != version.get('question_sha256'):
                raise ValueError(f'Question version fingerprint mismatch: {index}')
            if qid in used:
                versions[qid] = digest
                materials[qid].update(question_id=run['question_id'], question_sha256=digest)
            if rid in used:
                question_binding(case['materials'][rid], version['question_sha256'], digest)
                materials[rid].update(question_id=run['question_id'], question_sha256=digest,
                                      original_checks=case['materials'][rid]['checks'])
        if 'external_review' in used:
            loc = ref['source_locators']['external_review']
            external = source(loc['path'])
            review = case['materials']['external_review']
            digest = external['source_question_sha256']
            for mids in allowed.values():
                if 'external_review' in mids and digest not in {versions[mid] for mid in mids & versions.keys()}:
                    raise ValueError('External review version mismatch in selected view')
            question_binding(review, digest, digest)
            materials['external_review'].update(
                question_id=run['question_id'], question_sha256=digest, original_checks=review['checks'])
            costs.append({'source': loc['path'], 'model': external.get('model'),
                          'requests': external.get('requests'), 'cost_cny': external.get('cost_cny')})
    supplied_versions = notes.get('question_versions', {})
    if any(versions.get(mid) != digest for mid, digest in supplied_versions.items()):
        raise ValueError('Finding question version mismatch')

    findings = {}
    for row in notes['findings']:
        fid, vid, mid = row['finding_id'], row['view_id'], row['material_id']
        if fid in findings or mid not in allowed.get(vid, set()):
            raise ValueError(f'Duplicate finding or material outside selected view: {fid}')
        if row['verdict'] not in VERDICTS or not row['basis'].strip():
            raise ValueError(f'Invalid verdict or empty basis: {fid}')
        resolve_pointer(case['materials'][mid], row['location'])
        for evidence in row.get('evidence', []):
            if evidence['material_id'] not in allowed[vid]:
                raise ValueError(f'Evidence outside selected view: {fid}')
            resolve_pointer(case['materials'][evidence['material_id']], evidence['location'])
        if 'reference_check_id' in row:
            check = find_record(ref['checks'], 'check_id', row['reference_check_id'])
            if vid not in check['view_ids']:
                raise ValueError(f'Reference check outside selected view: {fid}')
        findings[fid] = row

    revision = notes.get('revision', [])
    expected = {
        'fixed': ('defect', 'supported_within_scope'),
        'persists': ('defect', 'defect'),
        'preserved': ('supported_within_scope', 'supported_within_scope'),
        'introduced': ('supported_within_scope', 'defect'),
    }
    for delta in revision:
        before = findings[delta['before']] if delta.get('before') is not None else None
        after = findings[delta['after']]
        change = delta['change']
        if not delta['scope'].strip() or change not in {*expected, 'unknown'}:
            raise ValueError('Invalid revision decision or empty comparison scope')
        if after['material_id'] not in versions or (
                before and (before['material_id'] not in versions
                            or int(before['material_id'][1:]) >= int(after['material_id'][1:]))):
            raise ValueError('Revision comparison must reference ordered question versions')
        if change in expected and (not before or (before['verdict'], after['verdict']) != expected[change]):
            raise ValueError(f'Revision evidence does not support {change}')

    audit_comparisons = notes.get('audit_comparisons', [])
    for comparison in audit_comparisons:
        review = findings[comparison['review_finding']]
        issue = findings[comparison['issue_finding']]
        audit = materials[review['material_id']]
        question = materials[issue['material_id']]
        if ('original_checks' not in audit or issue['material_id'] not in versions
                or audit['question_sha256'] != question['question_sha256']):
            raise ValueError('Audit comparison requires a review and issue from the same question version')
        if comparison['outcome'] not in {'detected', 'missed', 'false_alarm', 'pending'}:
            raise ValueError('Unknown audit comparison outcome')
        if not comparison['reason'].strip():
            raise ValueError('Audit comparison requires a reason')
        issue_verdict = {'detected': 'defect', 'missed': 'defect',
                         'false_alarm': 'supported_within_scope'}.get(comparison['outcome'])
        if issue_verdict and issue['verdict'] != issue_verdict:
            raise ValueError('Audit comparison lacks a compatible issue finding')

    missing = notes.get('missing', [])
    missing_ids = {entry['view_id'] for entry in missing}
    if missing_ids - set(selected) or any(not entry['reason'].strip() for entry in missing):
        raise ValueError('Missing observations must refer to requested views and have a reason')
    reviewed = {row['view_id'] for row in findings.values()} | set(notes.get('reviewed_view_ids', []))
    if reviewed - set(selected) or reviewed & missing_ids:
        raise ValueError('Reviewed views must be requested and cannot also be marked missing')
    for vid in selected:
        if vid not in reviewed and vid not in missing_ids:
            missing = [*missing, {'view_id': vid, 'reason': '尚无核对记录'}]
    return {
        'schema': 'education-offline-evaluation-v1',
        'set_id': bundle['set_id'], 'purpose': bundle['purpose'],
        'case_id': case['case_id'], 'title': case['title'], 'scope': case['scope'],
        'bundle_sha256': bundle_hashes, 'view_ids': selected,
        'assessment_source': notes['assessment_source'],
        'materials': materials, 'question_versions': versions,
        'source_status': source_status, 'findings': list(findings.values()),
        'revision': revision, 'audit_comparisons': audit_comparisons,
        'missing': missing, 'out_of_scope_view_ids': [vid for vid in views if vid not in selected],
        'historical_cost': costs, 'report_execution': {'model_calls': 0, 'java_executed': False},
    }


def render_markdown(report):
    verdicts = {'defect': '确定错误', 'supported_within_scope': '限定范围有依据', 'unresolved': '有待裁定'}
    changes = {'fixed': '已修复', 'persists': '仍存在', 'preserved': '已核行为保留',
               'introduced': '修订引入', 'unknown': '变化待定'}
    lines = [f"# {report['case_id']} {report['title']}", '',
             f"评阅依据来源为 {report['assessment_source']}。", '',
             report['scope'], '', '## 修订对照', '']
    for delta in report['revision']:
        lines.append(f"- **{changes[delta['change']]}** · {delta['scope']}（{delta.get('before') or '旧版缺证'} → {delta['after']}）")
    if report['audit_comparisons']:
        outcomes = {'detected': '检出', 'missed': '漏检', 'false_alarm': '误报', 'pending': '待裁定'}
        lines.extend(['', '## 审核对照', ''])
        for item in report['audit_comparisons']:
            lines.append(f"- **{outcomes[item['outcome']]}** · {item['reason']}（{item['review_finding']} / {item['issue_finding']}）")
    lines.extend(['', '## 逐项发现', ''])
    for item in report['findings']:
        detail = report['materials'][item['material_id']]
        loc = detail['source']
        lines.extend([
            f"- **{item['finding_id']} · {verdicts[item['verdict']]}** · {item['basis']}",
            f"  对象 `{item['material_id']}{item['location']}`，视图 `{item['view_id']}`。",
            f"  出处 `{loc.get('path', loc.get('kind'))}{loc.get('json_pointer', '')}`。",
        ])
        if 'question_sha256' in detail:
            lines.append(f"  题目指纹 `{detail['question_sha256']}`。")
    status = report['source_status']
    if status:
        execution = status['execution_check'] or {}
        lines.extend(['', f"保存结果状态为 `{status['status']}`，Java 验证状态为 `{execution.get('status', 'unknown')}`。"])
        if 'split_decision' in status:
            split = status['split_decision']
            lines.append(f"第 {split['version']} 版建议拆题。{split['reason']}")
    lines.extend(['', '## 评阅范围', ''])
    lines.extend(f"- {m['view_id']} · 缺测。{m['reason']}" for m in report['missing'])
    lines.extend(f"- {vid} · 本次范围之外。" for vid in report['out_of_scope_view_ids'])
    if report['historical_cost']:
        lines.extend(['', '## 历史开销', ''])
        for cost in report['historical_cost']:
            if 'requests_reserved' in cost:
                lines.append(f"- 原任务保留请求额度 {cost['requests_reserved']}。{cost['reason']}。")
            else:
                lines.append(f"- 外部复核请求数 {cost['requests']}，保存费用（人民币）{cost['cost_cny']}。")
    return '\n'.join(lines) + '\n'
