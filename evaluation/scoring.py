"""Score saved Stage D observations. No generation, review, or sample code runs here."""

from fractions import Fraction
from itertools import combinations
import json
import re

from evaluation.report import digest_bytes
from generation.workflow import DIMENSIONS
from profiling.run_store import fingerprint


ARMS = ('A', 'B', 'C')
METRICS = ('primary_score', 'sample_accuracy_score', 'coverage_score')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique_object)


def verify_sample_counts(label, recorded, question_samples, task):
    require(recorded['task'] == task, f'{label}: sample task mismatch')
    samples = recorded['samples']
    require(isinstance(samples, list) and samples and len(samples) == len(question_samples),
            f'{label}: missing or unbound sample observations')
    correct = 0
    covered = None
    for index, (sample, question_sample) in enumerate(zip(samples, question_samples)):
        where = f'{label} sample {index + 1}'
        flags = sample['covers']
        require(isinstance(flags, list) and flags and all(type(v) is bool for v in flags),
                f'{where}: expected a nonempty vector of Boolean coverage flags')
        if covered is None:
            covered = [False] * len(flags)
        require(len(flags) == len(covered), f'{where}: inconsistent condition count')
        covered = [already or observed for already, observed in zip(covered, flags)]
        expected, stored = sample['expected'], sample['stored']
        require(isinstance(expected, str) and isinstance(stored, str)
                and stored == question_sample['output'], f'{where}: stored sample output mismatch')
        matches = sample['output_matches']
        require(type(matches) is bool and matches == (stored.split() == expected.split()),
                f'{where}: inconsistent frozen output_matches flag')
        correct += matches
    return correct, len(samples), sum(covered), len(covered)


def load_blind_records(directory, manifest, tasks):
    filenames = {'findings.json', 'sample-recomputation.json', 'check_samples.py'}
    require(all(re.fullmatch(r'H[0-9]+', task) for task in tasks), 'Unsupported Stage D task ID')
    require(set(manifest) == filenames | {f'{t}.json' for t in tasks},
            'Freeze manifest and evaluation tasks do not match')
    frozen = {}
    for filename, digest in manifest.items():
        raw = (directory / filename).read_bytes()
        require(digest_bytes(raw) == digest, f'Freeze SHA-256 mismatch: {filename}')
        if filename.endswith('.json'):
            frozen[filename] = parse(raw)

    findings = frozen['findings.json']['cases']
    observations = frozen['sample-recomputation.json']
    records = {}
    for task in tasks:
        packet = frozen[f'{task}.json']
        require(packet['task']['id'] == packet['rubric']['id'] == task, f'{task}: blind packet mismatch')
        condition_count = None
        for item in packet['items']:
            label = item['id']
            require(label not in records, f'Duplicate blind version: {label}')
            require(label in findings and label in observations, f'{label}: missing frozen observations')
            defects = findings[label]['defects']
            require(isinstance(defects, list), f'{label}: missing defect assessment')
            ids = [defect['id'] for defect in defects]
            require(all(isinstance(i, str) and i for i in ids) and len(ids) == len(set(ids)),
                    f'{label}: invalid defect IDs')
            correct, samples, covered, conditions = verify_sample_counts(
                label, observations[label], item['question']['samples'], task)
            if condition_count is None:
                condition_count = conditions
            require(condition_count == conditions, f'{task}: inconsistent condition count across versions')
            require(ids or (correct == samples and covered == conditions),
                    f'{label}: empty defect list conflicts with failed sample or missing condition')
            scores = {
                'id': label, 'defect_ids': ids, 'primary_score': 0 if ids else 100,
                'correct_samples': correct, 'total_samples': samples,
                'sample_accuracy_score': Fraction(100 * correct, samples),
                'covered_conditions': covered, 'total_conditions': conditions,
                'coverage_score': Fraction(100 * covered, conditions),
            }
            records[label] = (task, item['question'], scores)
    require(set(findings) == set(observations) == set(records), 'Different blind version sets')
    return records


def verified_versions(execution, task, arm, row, records, mapping):
    where = f'{task}/{arm}'
    source = parse((execution / 'cases' / task / arm / 'generation.json').read_bytes())
    require(source['schema'] == 'generation-result-v1', f'{where}: unknown generation schema')
    require(source['identity']['arm'] == arm and source['student_id'] == f'fixture:stage-d:{task}',
            f'{where}: source task or arm mismatch')
    require(source['identity']['request_sha256'] == source['request_sha256'] == row['request_sha256'],
            f'{where}: request binding mismatch')
    status = row['formal_status']
    require(status in ('needs_review', 'rejected', 'needs_split', 'failed'),
            f'{where}: unsupported formal status {status!r}')
    has_final = status in ('needs_review', 'rejected')
    require(source['status'] == status and source['execution_status'] == ('failed' if status == 'failed' else 'completed'),
            f'{where}: inconsistent formal status')
    raw_versions = source['versions']
    require(isinstance(raw_versions, list) and len(raw_versions) <= 2, f'{where}: unsupported version sequence')
    source_questions = []
    split = False
    for number, saved in enumerate(raw_versions, 1):
        require(type(saved['version']) is int and saved['version'] == number, f'{where}: wrong source version')
        question = saved['question']
        if question['outcome'] == 'needs_split':
            require(status == 'needs_split' and number == len(raw_versions)
                    and isinstance(question['reason'], str) and question['reason'].strip(),
                    f'{where}: invalid split decision, reason, or position')
            split = True
        else:
            require(question['outcome'] == 'question', f'{where}: unsupported saved outcome')
            source_questions.append(saved)
    require(split == (status == 'needs_split'), f'{where}: split decision disagrees with status')
    versions = row['versions']
    require(isinstance(versions, list) and len(versions) == len(source_questions),
            f'{where}: summary does not contain exactly the saved question versions')
    draft = versions[0] if versions else None
    require(row['draft'] == draft, f'{where}: draft is not the first saved version')
    require(not has_final or versions, f'{where}: completed question row lacks versions')
    final = versions[-1] if has_final else None
    require(row['final'] == final, f'{where}: final version contradicts formal status')
    bound = []
    for version, saved in zip(versions, source_questions):
        number = saved['version']
        label = version['id']
        require(label in records, f'{where}: unknown blind version {label}')
        blind_task, question, scores = records[label]
        require(blind_task == task and type(version['version']) is int and version['version'] == number,
                f'{where}: version or task mismatch')
        original = saved['question']
        digest = fingerprint(original)
        require(digest == saved['question_sha256'] == version['sha256'],
                f'{where}/{label}: source question fingerprint mismatch')
        projection = {k: v for k, v in original.items() if k not in ('outcome', 'reason')}
        require(projection == question, f'{where}/{label}: blind question differs from source')
        require({'arm': arm, 'task': task, 'version': number, 'sha256': digest} in mapping[label],
                f'{where}/{label}: anonymous version mapping mismatch')
        require(version['defect_ids'] == scores['defect_ids'], f'{where}/{label}: defect list mismatch')
        review = saved['review']
        failed_dimensions = None
        if review is not None:
            require(review['question_sha256'] == digest, f'{where}/{label}: formal review binding mismatch')
            checks = review['checks']
            require(isinstance(checks, list) and len(checks) == len(DIMENSIONS)
                    and {c['dimension'] for c in checks} == set(DIMENSIONS)
                    and all(c['status'] in ('pass', 'uncertain', 'not_applicable', 'fail') for c in checks),
                    f'{where}/{label}: invalid formal checks')
            failed_dimensions = [c['dimension'] for c in checks if c['status'] == 'fail']
        require(version['formal_fail_dimensions'] == failed_dimensions,
                f'{where}/{label}: formal review differs from summary')
        if number < len(raw_versions) or status == 'rejected':
            require(failed_dimensions, f'{where}/{label}: missing failed formal review')
        elif status == 'needs_review':
            require(failed_dimensions == [], f'{where}/{label}: missing accepted final review')
        bound.append(dict(scores, version=number, sha256=digest))
    return {'formal_status': status, 'draft': bound[0] if draft else None,
            'final': bound[-1] if final else None}


def compare(pairs):
    available = [(first, second) for first, second in pairs if first is not None and second is not None]
    count = len(available)
    metrics = {}
    for name in METRICS:
        before = after = delta = relative = None
        if count:
            before = sum((a[name] for a, _ in available), Fraction()) / count
            after = sum((b[name] for _, b in available), Fraction()) / count
            delta = after - before
            if before:
                relative = 100 * delta / before
        metric = {'before_mean': before, 'after_mean': after, 'change_pp': delta, 'relative_pct': relative}
        if name == 'primary_score':
            metric.update(before_passed=sum(a[name] == 100 for a, _ in available),
                          after_passed=sum(b[name] == 100 for _, b in available))
        metrics[name] = metric
    return {'included': count, 'total': len(pairs), 'metrics': metrics}


def comparisons(rows):
    by_arm = {a: [(r[a]['draft'], r[a]['final']) for r in rows.values()] for a in ARMS}
    all_pairs = [pair for pairs in by_arm.values() for pair in pairs]
    result = {'all': {'draft_to_final': compare(all_pairs)}}
    result.update({arm: {'draft_to_final': compare(pairs)} for arm, pairs in by_arm.items()})
    for earlier, later in combinations(ARMS, 2):
        result[f'{later}-{earlier}'] = {
            phase: compare([(r[earlier][phase], r[later][phase]) for r in rows.values()])
            for phase in ('draft', 'final')
        }
    return result


def json_numbers(value):
    if isinstance(value, Fraction):
        return value.numerator if value.denominator == 1 else float(value)
    if isinstance(value, dict):
        return {key: json_numbers(item) for key, item in value.items()}
    return value


def score_execution(execution):
    raw_summary = (execution / 'evaluation-summary.json').read_bytes()
    summary = parse(raw_summary)
    require(summary['schema'] == 'stage-d-static-review-v1', 'Unsupported evaluation summary schema')
    tasks = summary['rows']
    require(isinstance(tasks, dict) and tasks, 'Expected nonempty task rows')
    directory = execution / 'blind-review'
    raw_manifest = (directory / 'findings-freeze.json').read_bytes()
    manifest = parse(raw_manifest)
    require(summary['blind_findings_sha256'] == manifest['findings.json'], 'Blind findings SHA-256 mismatch')
    records = load_blind_records(directory, manifest, tasks)
    raw_mapping = (directory / 'mapping.json').read_bytes()
    mapping = parse(raw_mapping)
    require(set(mapping) == set(records), 'Mapping and frozen version sets differ')
    rows = {}
    binding_count = 0
    for task, arms in tasks.items():
        require(set(arms) == set(ARMS), f'{task}: expected A, B and C rows, with explicit missing phases')
        require(len({r['request_sha256'] for r in arms.values()}) == 1, f'{task}: different requests across arms')
        rows[task] = {}
        for arm in ARMS:
            row = arms[arm]
            rows[task][arm] = verified_versions(execution, task, arm, row, records, mapping)
            binding_count += len(row['versions'])
    require(all(isinstance(bindings, list) and bindings for bindings in mapping.values())
            and binding_count == sum(map(len, mapping.values())), 'Unexpected extra or missing version mappings')
    return json_numbers({
        'schema': 'stage-d-paired-scores-v1',
        'source_sha256': {'evaluation-summary.json': digest_bytes(raw_summary),
                          'findings-freeze.json': digest_bytes(raw_manifest),
                          'findings.json': manifest['findings.json'],
                          'sample-recomputation.json': manifest['sample-recomputation.json'],
                          'mapping.json': digest_bytes(raw_mapping)},
        'rows': rows, 'comparisons': comparisons(rows),
    })
