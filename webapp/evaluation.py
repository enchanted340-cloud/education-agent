"""Read the display fields from the saved Stage D experiment."""

from fractions import Fraction
from math import isclose, isfinite
from pathlib import Path

from evaluation.report import digest_bytes
from evaluation.scoring import (
    ARMS, METRICS, comparisons, json_numbers, parse, require, verify_sample_counts,
)
from profiling.run_store import fingerprint


ARCHIVE = Path('experiments/stage-d-20261118/execution')
CASES = (
    ('H08', 'A', 0, '样例未覆盖重复选取会改变答案的情形'),
    ('H03', 'A', 1, '修订更换数组并修正最左平衡位置的样例'),
    ('H01', 'A', 2, '修订修正列号，仍缺奇数行起点样例'),
    ('H06', 'B', 0, '题面把参考解析的贪心思路写成学生解法要求'),
)


class EvaluationReadError(Exception):
    pass


def read_record(execution, relative, digest=None):
    path = (execution / relative).resolve()
    require(path.is_relative_to(execution), 'Record outside the archive')
    raw = path.read_bytes()
    if digest is not None:
        require(digest_bytes(raw) == digest, f'Archive fingerprint mismatch: {relative}')
    return parse(raw)


def text_fields(record, *keys):
    fields = {key: record[key] for key in keys}
    require(all(isinstance(value, str) for value in fields.values()), 'Expected display text')
    return fields


def check_comparison(saved, calculated):
    for field in ('included', 'total'):
        require(type(saved[field]) is int and saved[field] == calculated[field], 'Incorrect pair count')
    metrics = saved['metrics']
    require(metrics.keys() == calculated['metrics'].keys(), 'Unexpected metric names')
    for name, expected in calculated['metrics'].items():
        metric = metrics[name]
        require(metric.keys() == expected.keys(), 'Unexpected metric fields')
        for field, value in expected.items():
            actual = metric[field]
            if value is None:
                require(actual is None, 'Score for unavailable metric')
            elif field.endswith('_passed'):
                require(type(actual) is int and actual == value, 'Pass count disagrees with rows')
            else:
                require(type(actual) in (int, float) and isclose(actual, value, abs_tol=1e-9),
                        'Metric disagrees with rows')
    return metrics


def verify_score_rows(rows, scored):
    require(rows.keys() == scored.keys(), 'Different task sets')
    for task, arms in rows.items():
        require(set(arms) == set(scored[task]) == set(ARMS), 'Different arm sets')
        for arm, row in arms.items():
            score = scored[task][arm]
            require(score['formal_status'] == row['formal_status'], 'Different formal status')
            for phase in ('draft', 'final'):
                version, result = row[phase], score[phase]
                require((version is None) == (result is None), 'Different scored version availability')
                if version is None:
                    continue
                require(all(result[key] == version[key] for key in ('id', 'version', 'sha256', 'defect_ids')),
                        'Different scored version identities')
                require(all(type(result[name]) in (int, float) and isfinite(result[name])
                            and 0 <= result[name] <= 100 for name in METRICS), 'Invalid row score')
                require(result['primary_score'] == (0 if version['defect_ids'] else 100),
                        'Primary score disagrees with blind assessment')


def case_version(item, saved, question, binding, finding, observed, scored, task, arm, sample_index):
    label, number = item['id'], item['version']
    original = saved['question']
    digest = fingerprint(original)
    require(number == saved['version'] and item['sha256'] == saved['question_sha256'] == digest
            and {'arm': arm, 'task': task, 'version': number, 'sha256': digest} in binding,
            'Unbound question version')
    require(original['outcome'] == 'question'
            and {k: v for k, v in original.items() if k not in ('outcome', 'reason')} == question,
            'Anonymous question differs from saved question')
    defects = finding['defects']
    require([defect['id'] for defect in defects] == item['defect_ids'], 'Different blind findings')
    correct, samples, covered, conditions = verify_sample_counts(label, observed, question['samples'], task)
    scores = json_numbers({
        'primary_score': 0 if defects else 100,
        'sample_accuracy_score': Fraction(100 * correct, samples),
        'coverage_score': Fraction(100 * covered, conditions),
    })
    if scored is not None:
        expected_scores = dict(scores, id=label, version=number, sha256=digest, defect_ids=item['defect_ids'])
        require(all(scored[key] == value for key, value in expected_scores.items()),
                'Saved score disagrees with its blind assessment')
    review = saved['review']
    failed = item['formal_fail_dimensions']
    if review is None:
        require(failed is None and scored is None, 'Unexpected formal review result')
        status = '复审缺测，未计入终稿'
    else:
        require(review['question_sha256'] == digest and [
            check['dimension'] for check in review['checks'] if check['status'] == 'fail'
        ] == failed, 'Unbound formal review')
        status = '流程审核发现问题' if failed else '流程审核已完成，待人工复核'
    return {
        'version': number, 'status': status, **text_fields(question, 'statement'),
        'sample': text_fields(question['samples'][sample_index], 'input', 'output', 'explanation'),
        'expected': observed['samples'][sample_index]['expected'],
        'findings': [text_fields(defect, 'detail')['detail'] for defect in defects],
        'scores': scores,
    }


def read_case(execution, task, arm, sample_index, subtitle, row, scored, freeze, findings, samples, mapping):
    filename = f'{task}.json'
    packet = read_record(execution, f'blind-review/{filename}', freeze[filename])
    require(packet['task']['id'] == packet['rubric']['id'] == task, 'Incorrect anonymous task')
    questions = {item['id']: item['question'] for item in packet['items']}
    require(len(questions) == len(packet['items']), 'Duplicate anonymous question')
    case_dir = f'cases/{task}/{arm}'
    request = read_record(execution, f'{case_dir}/request.json')
    source = read_record(execution, f'{case_dir}/generation.json')
    fixture = f'fixture:stage-d:{task}'
    require(request['schema'] == 'generation-request-v1' and request['fixture_only'] is True
            and source['schema'] == 'generation-result-v1' and source['identity']['arm'] == arm
            and source['student_id'] == request['student_id'] == fixture, 'Incorrect experiment source')
    require(fingerprint(request) == row['request_sha256'] == source['request_sha256']
            == source['identity']['request_sha256'], 'Unbound teacher request')
    requirement = text_fields(packet['task'], 'teacher')['teacher']
    require(request['requirements'] == [requirement], 'Teacher request differs from the anonymous task')
    status = source['status']
    versions = row['versions']
    require(status in ('failed', 'needs_review') and status == row['formal_status'] == scored['formal_status']
            and source['execution_status'] == ('failed' if status == 'failed' else 'completed')
            and len(versions) in (1, 2) and len(versions) == len(source['versions'])
            and row['draft'] == versions[0]
            and row['final'] == (versions[-1] if status == 'needs_review' else None)
            and scored['draft'] is not None
            and (scored['final'] is None) == (row['final'] is None), 'Inconsistent generation receipt')
    projected = []
    for number, (item, saved) in enumerate(zip(versions, source['versions']), 1):
        label = item['id']
        require(type(item['version']) is int and item['version'] == number, 'Incorrect version order')
        phase = 'draft' if item == row['draft'] else 'final' if item == row['final'] else None
        projected.append(case_version(item, saved, questions[label], mapping[label], findings[label],
                                      samples[label], scored[phase] if phase else None, task, arm, sample_index))
    if row['draft'] == row['final']:
        require(scored['draft'] == scored['final'], 'Draft and final differ for the same question')
    return {'task': task, 'arm': arm, **text_fields(questions[versions[0]['id']], 'title'),
            'subtitle': subtitle, 'requirement': requirement, 'versions': projected}


def project(execution):
    report = read_record(execution, 'score-report.json')
    require(report['schema'] == 'stage-d-paired-scores-v1', 'Unknown score schema')
    digests = report['source_sha256']
    summary = read_record(execution, 'evaluation-summary.json', digests['evaluation-summary.json'])
    freeze = read_record(execution, 'blind-review/findings-freeze.json', digests['findings-freeze.json'])
    require(summary['schema'] == 'stage-d-static-review-v1'
            and summary['blind_findings_sha256'] == freeze['findings.json'] == digests['findings.json']
            and freeze['sample-recomputation.json'] == digests['sample-recomputation.json'],
            'Blind evaluation fingerprints differ')
    findings = read_record(execution, 'blind-review/findings.json', digests['findings.json'])['cases']
    samples = read_record(execution, 'blind-review/sample-recomputation.json', digests['sample-recomputation.json'])
    mapping = read_record(execution, 'blind-review/mapping.json', digests['mapping.json'])
    require(findings.keys() == samples.keys() == mapping.keys(), 'Different anonymous version sets')
    rows, scored = summary['rows'], report['rows']
    verify_score_rows(rows, scored)
    task_count, arm_count = len(rows), len(ARMS)
    saved_comparisons = report['comparisons']
    calculated = comparisons(scored)
    overall = saved_comparisons['all']['draft_to_final']
    metrics = check_comparison(overall, calculated['all']['draft_to_final'])
    skills = []
    for skilled_arm in ('B', 'C'):
        key = f'{skilled_arm}-A'
        phases = {}
        for phase in ('draft', 'final'):
            comparison = saved_comparisons[key][phase]
            primary = check_comparison(comparison, calculated[key][phase])['primary_score']
            phases[phase] = {'included': comparison['included'], 'primary': primary}
        deltas = [arms[skilled_arm]['draft']['primary_score'] - arms['A']['draft']['primary_score']
                  for arms in scored.values() if arms[skilled_arm]['draft'] is not None and arms['A']['draft'] is not None]
        counts = {'improved': sum(delta > 0 for delta in deltas),
                  'regressed': sum(delta < 0 for delta in deltas), 'tied': deltas.count(0)}
        skills.append({'key': key, **phases['draft'], 'draftCounts': counts, 'final': phases['final']})
    cases = [read_case(execution, task, arm, index, subtitle, rows[task][arm], scored[task][arm],
                       freeze, findings, samples, mapping) for task, arm, index, subtitle in CASES]
    improved_tasks = sum(any(row['draft'] is not None and row['final'] is not None
                             and row['draft']['primary_score'] < row['final']['primary_score']
                             for row in arms.values()) for arms in scored.values())
    return {'available': True, 'taskCount': task_count, 'armCount': arm_count,
            'total': overall['total'], 'paired': overall['included'],
            'metrics': metrics, 'skills': skills, 'cases': cases, 'improvedTaskCount': improved_tasks}


def read_evaluation(root):
    archive = Path(root).resolve().parent / ARCHIVE
    try:
        try:
            archive.lstat()
        except FileNotFoundError:
            return {'available': False}
        require(archive.resolve() == archive, 'Experiment archive location redirected')
        return project(archive)
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError, OverflowError) as exc:
        raise EvaluationReadError from exc
