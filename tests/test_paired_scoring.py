from fractions import Fraction
import unittest

from evaluation.scoring import compare, verify_sample_counts


class PairedScoringTests(unittest.TestCase):
    def test_partial_observations_do_not_change_the_denominator(self):
        first = {'primary_score': 0, 'sample_accuracy_score': 100, 'coverage_score': Fraction(200, 3)}
        last = {'primary_score': 100, 'sample_accuracy_score': 100, 'coverage_score': 100}
        result = compare([(first, last), (last, None), (None, first)])
        self.assertEqual((result['included'], result['total']), (1, 3))
        primary = result['metrics']['primary_score']
        self.assertEqual((primary['before_passed'], primary['after_passed'], primary['change_pp']), (0, 1, 100))
        self.assertIsNone(primary['relative_pct'])
        self.assertEqual(result['metrics']['coverage_score']['relative_pct'], 50)
        self.assertIsNone(compare([(None, last)])['metrics']['primary_score']['change_pp'])

    def test_repeated_samples_only_cover_one_distinct_condition(self):
        sample = {'stored': '6', 'expected': '6', 'output_matches': True, 'covers': [True, False]}
        recorded = {'task': 'H08', 'samples': [sample, sample]}
        questions = [{'output': '6'}, {'output': '6'}]
        self.assertEqual(verify_sample_counts('Q17', recorded, questions, 'H08'), (2, 2, 1, 2))
        questions[1]['output'] = '10'
        with self.assertRaises(ValueError):
            verify_sample_counts('Q17', recorded, questions, 'H08')


if __name__ == '__main__':
    unittest.main()
