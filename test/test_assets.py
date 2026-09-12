import pathlib
import unittest


class AssetTests(unittest.TestCase):
    def test_background_music_is_flac(self):
        path = pathlib.Path(__file__).resolve().parents[1] / "background-music.flac"
        self.assertTrue(path.is_file(), "background-music.flac is missing")
        with path.open("rb") as handle:
            self.assertEqual(handle.read(4), b"fLaC")


if __name__ == "__main__":
    unittest.main()
