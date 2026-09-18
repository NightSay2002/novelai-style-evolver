import json
import pathlib
import unittest


class AssetTests(unittest.TestCase):
    def test_artist_pool_requires_at_least_150_posts(self):
        path = pathlib.Path(__file__).resolve().parents[1] / "data" / "artists.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["minimumPostCount"], 150)
        self.assertEqual(len(data["artists"]), 17519)
        self.assertTrue(all(item["postCount"] >= 150 for item in data["artists"]))

    def test_background_music_is_flac(self):
        path = pathlib.Path(__file__).resolve().parents[1] / "background-music.flac"
        self.assertTrue(path.is_file(), "background-music.flac is missing")
        with path.open("rb") as handle:
            self.assertEqual(handle.read(4), b"fLaC")


if __name__ == "__main__":
    unittest.main()
