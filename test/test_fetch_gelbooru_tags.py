import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_gelbooru_tags.py"
SPEC = importlib.util.spec_from_file_location("gelbooru_tags", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GelbooruTagTests(unittest.TestCase):
    def test_prompt_tag(self):
        self.assertEqual(MODULE.prompt_tag("Watercolor_(Medium)"), "watercolor (medium)")
        self.assertEqual(MODULE.DEFAULT_ARTIST_THRESHOLD, 150)

    def test_style_output_only_accepts_curated_seed_tags(self):
        metadata = {
            "watercolor_(medium)": {"name": "watercolor_(medium)", "postCount": 999},
            "card_(orange-r)": {"name": "card_(orange-r)", "postCount": 126},
            "adversarial_noise": {"name": "adversarial_noise", "postCount": 8464},
            "corrupted_file": {"name": "corrupted_file", "postCount": 133},
            "alpha_transparency": {"name": "alpha_transparency", "postCount": 1655},
        }
        output = MODULE.build_style_output(metadata, 50)
        tags = {item["tag"]: item for item in output["tags"]}
        self.assertEqual(output["version"], 3)
        self.assertEqual(output["metadataPolicy"], "rendering-curated")
        self.assertEqual(tags["watercolor (medium)"]["postCount"], 999)
        for unsafe in ["card (orange-r)", "adversarial noise", "corrupted file", "alpha transparency"]:
            self.assertNotIn(unsafe, tags)

    def test_atomic_json_is_utf8_and_replaces_target(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.json"
            MODULE.atomic_json(path, {"name": "畫師"})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"name": "畫師"})
        self.assertFalse(path.with_suffix(".json.tmp").exists())

    def test_committed_style_pool_has_one_thousand_unique_terms(self):
        seed_path = Path(__file__).resolve().parents[1] / "data" / "style-tags.seed.json"
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        tags = [item["tag"] for item in seed["tags"]]
        self.assertEqual(seed["targetCount"], 1000)
        self.assertEqual(len(tags), 1000)
        self.assertEqual(len(tags), len(set(tags)))
        self.assertTrue({"best quality", "watercolor (medium)", "artist collaboration"}.issubset(tags))


if __name__ == "__main__":
    unittest.main()
