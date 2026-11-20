import json
from pathlib import Path
import tempfile
import unittest

from evaluation.report import build_report, digest_bytes, prepare_view, question_binding, render_markdown, resolve_pointer
from profiling.run_store import fingerprint


class SavedEvaluationTests(unittest.TestCase):
    def report_for_run(self, status, versions):
        run = {'status': status, 'versions': versions, 'question_id': 'test:question',
               'ready_for_student': False, 'execution_check': {'status': 'not_run'}}
        case = {'case_id': 'test', 'title': '测试任务', 'scope': '终态',
                'materials': {'status': status}, 'views': [{'view_id': 'result', 'material_ids': ['status']}]}
        raw = json.dumps(run).encode()
        ref = {'case_id': 'test', 'recorded_run': {'path': 'generation.json'},
               'source_locators': {'status': {'path': 'generation.json', 'json_pointer': '/status'}}}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'generation.json').write_bytes(raw)
            return build_report({'set_id': 's', 'purpose': 'test', 'cases': [case]},
                                {'set_id': 's', 'cases': [ref], 'source_files': {
                                    'generation.json': {'sha256': digest_bytes(raw)}}},
                                {'set_id': 's', 'case_id': 'test', 'view_ids': ['result'],
                                 'assessment_source': 'test', 'findings': []}, root, {'cases': 's'})

    def test_split_at_either_generation_step_preserves_reason(self):
        draft = {'outcome': 'question', 'title': '初稿'}
        previous = {'version': 1, 'question': draft, 'question_sha256': fingerprint(draft)}
        for prefix in ([], [previous]):
            number = len(prefix) + 1
            split = {'version': number, 'question': {'outcome': 'needs_split', 'reason': '目标应分别练习'}}
            report = self.report_for_run('needs_split', [*prefix, split])
            self.assertEqual(report['source_status']['split_decision']['version'], number)
            self.assertIn('目标应分别练习', render_markdown(report))
            self.assertNotIn(f'q{number}', report['question_versions'])

    def test_failed_before_first_draft_stays_visible(self):
        report = self.report_for_run('failed', [])
        self.assertEqual(report['question_versions'], {})
        self.assertIn('failed', render_markdown(report))

    def test_prepare_projects_only_selected_materials(self):
        case = {
            'case_id': 'G02',
            'materials': {'draft': {}, 'revision': {'statement': '题目'}, 'answer': 0},
            'views': [{'view_id': 'v2', 'kind': 'review_audit',
                       'instruction': '检查第二版', 'material_ids': ['revision']}],
        }
        packet = prepare_view(case, 'v2')
        self.assertEqual(packet['materials'], {'revision': {'statement': '题目'}})
        self.assertNotIn('views', packet)
        with self.assertRaises(ValueError):
            prepare_view(case, 'missing')

    def test_external_review_cannot_claim_a_different_version(self):
        first = fingerprint({'statement': 'first'})
        second = fingerprint({'statement': 'second'})
        review = {'question_sha256': second}
        self.assertEqual(question_binding(review, second, second), second)
        with self.assertRaises(ValueError):
            question_binding(review, first, second)

    def test_json_pointer_handles_escaped_keys_and_rejects_negative_index(self):
        self.assertEqual(resolve_pointer({'a/b': [2]}, '/a~1b/0'), 2)
        with self.assertRaises(ValueError):
            resolve_pointer([1], '/-1')
