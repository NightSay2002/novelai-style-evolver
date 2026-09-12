#!/usr/bin/env python3
"""Build a 1,000-term style/quality pool from public Danbooru tags and curation.

The API is used only for public tag names and counts.  General tags that describe
characters, objects, poses, clothing, or file state are deliberately excluded.
The generated seed remains editable and can be rebuilt without the API by using
the committed JSON file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DANBOORU_TAGS_URL = "https://danbooru.donmai.us/tags.json"

# Wildcards target tag families that commonly affect rendering rather than
# subject matter.  Each request is capped at the public API's 1,000-record limit.
ONLINE_PATTERNS = (
    "*_style", "*_artstyle", "*_coloring", "*_medium", "*_painting",
    "*_lineart", "*_shading", "*_palette", "*_lighting", "*_texture",
    "*_effect", "*_rendering", "*_illustration", "*_aesthetic", "*_tone",
    "*_colors", "*_colour*", "*_ink", "*_pencil", "*_sketch", "*_comic",
    "*_manga", "*_anime", "*_retro", "*_vintage", "*_abstract", "*_pixel*",
    "*_cel*", "*_gradient", "*_halftone", "*_hatching", "*_dither*",
    "*_bokeh", "*_glow*", "*_shadow", "*_film*",
)

# These terms are subject, workflow, or file-state vocabulary even when they
# happen to contain a rendering keyword.
EXCLUDED = re.compile(
    r"(?:background|hair|eye|skin|clothes|clothing|dress|shirt|skirt|sleeve|"
    r"shoe|foot|leg|arm|hand|face|mouth|lip|breast|body|penis|vulva|pussy|"
    r"nipple|tail|wing|horn|ear|weapon|flower|food|drink|animal|girl|boy|"
    r"character|person|request|holding|through|object|symbol|school|uniform|"
    r"pokemon|copyright|artist|logo|username|source|commentary|translation|"
    r"commission|sample|screenshot|photo|image|card|book|cover|panel|page|"
    r"meme|game|parody|celebration|cell|celica|celestial|aviation|racing|"
    r"status effect|sound effect|makeup|apple pencil|wooden pencil|egg painting|"
    r"finger painting|brush$|brush_(?:teeth|hair)|"
    r"anime\s*screen|3d\s*background|official|ai[- ]generated|meta|bad_|"
    r"check_|has_|available|artifacts|edited|recolored|recolor|transparent|"
    r"simple|complexity|resolution|quality|text|speech|glitch|error|occlusion|"
    r"censored|uncensored|underwater|panorama|perspective|angle|view|shot|"
    r"close[- ]up|portrait|landscape|scenery|scenic|depth\s*of\s*field|"
    r"lighting\s*(?:of|for)|effect\s*(?:of|for)|style\s*request)",
    re.IGNORECASE,
)

INCLUDED = re.compile(
    r"(?:style|artstyle|coloring|medium|painting|lineart|shading|palette|"
    r"lighting|texture|effect|rendering|illustration|aesthetic|tone|colors?|"
    r"colour|ink|pencil|brush|sketch|comic|manga|anime|photorealistic|realistic|"
    r"retro|vintage|abstract|pixel|cel|gradient|halftone|hatching|dither|bokeh|"
    r"glow|shadow|film|monochrome|greyscale|pastel|painterly|watercolor|oil|"
    r"gouache|acrylic|charcoal|sepia|neon|silhouette|stipple|crosshatch|"
    r"screentone|doodle|chibi|toon)",
    re.IGNORECASE,
)


def normalize(name: str) -> str:
    value = re.sub(r"_+", " ", str(name).strip().lower())
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s+\((medium|style)\)$", r" (\1)", value)
    return value


def category_for(tag: str) -> str:
    if tag in {"bad quality", "worst quality", "displeasing", "very displeasing", "simple illustration"}:
        return "negative"
    if tag.startswith("year ") or re.fullmatch(r"\d{4}s \(style\)", tag):
        return "year"
    if any(word in tag for word in ("quality", "resolution", "absurdres")):
        return "quality"
    if any(word in tag for word in ("aesthetic", "masterpiece", "pleasing", "appealing")):
        return "aesthetic"
    if any(word in tag for word in ("color", "colour", "palette", "tone", "monochrome", "greyscale", "sepia")):
        return "coloring"
    if any(word in tag for word in ("light", "lighting", "glow", "shadow", "bloom", "flare", "ray")):
        return "lighting"
    if any(word in tag for word in ("lineart", "line art", "sketch", "hatch", "stipple", "ink", "pencil", "brush")):
        return "linework"
    if any(word in tag for word in ("texture", "grain", "halftone", "screentone", "dither", "paper", "canvas")):
        return "texture"
    if any(word in tag for word in ("render", "cel", "3d", "pixel", "vector", "toon")):
        return "rendering"
    if any(word in tag for word in ("watercolor", "painting", "medium", "gouache", "acrylic", "pastel", "charcoal")):
        return "medium"
    if any(word in tag for word in ("visual novel", "sprite", "comic", "manga", "webtoon", "manhwa")):
        return "visual_novel"
    return "custom"


QUALITY = (
    "best quality", "amazing quality", "great quality", "normal quality", "masterpiece",
    "absurdres", "ultra detailed", "highly detailed", "intricate details", "fine details",
    "high quality render", "crisp details", "ultra high detail", "professional illustration",
    "production quality", "polished illustration", "refined artwork", "clean finish",
)

AESTHETIC = (
    "top aesthetic", "very aesthetic", "aesthetic", "pleasing aesthetic", "beautiful aesthetic",
    "elegant aesthetic", "dreamy aesthetic", "cinematic aesthetic", "editorial aesthetic",
    "stylized aesthetic", "artistic aesthetic", "atmospheric aesthetic", "cohesive aesthetic",
    "visual harmony", "balanced design", "refined design", "expressive design", "visual poetry",
    "whimsical aesthetic", "nostalgic aesthetic", "ethereal aesthetic", "moody aesthetic",
)

MEDIUMS = (
    "digital painting", "digital illustration", "digital art", "traditional painting", "oil painting",
    "acrylic painting", "watercolor painting", "gouache painting", "ink wash painting", "ink painting",
    "sumi-e", "colored pencil", "graphite drawing", "charcoal drawing", "pastel drawing", "crayon drawing",
    "marker rendering", "alcohol marker", "copics", "airbrush", "brush pen", "pen and ink", "ballpoint pen",
    "technical pen", "calligraphy brush", "dry brush", "wet brush", "chalk pastel", "soft pastel",
    "oil pastel", "casein painting", "tempera painting", "encaustic painting", "encaustic art",
    "mixed media", "collage art", "paper cutout", "paper craft", "cut paper illustration", "linocut",
    "woodblock print", "screen print", "risograph print", "lithograph", "etching", "engraving",
    "monotype", "cyanotype", "fresco painting", "mosaic art", "stained glass art", "textile art",
    "fabric art", "embroidery art", "needle felting", "clay art", "ceramic art", "sculptural art",
    "3d art", "3d rendering", "low poly art", "voxel art", "pixel art", "vector art", "svg art",
    "isometric illustration", "generative art", "glitch art", "ascii art", "typographic art",
    "concept art", "fine art", "folk art", "naive art", "outsider art", "street art", "graffiti art",
    "editorial illustration", "fashion illustration", "botanical illustration", "scientific illustration",
    "storybook illustration", "children's book illustration", "poster illustration", "cover illustration",
)

RENDERING = (
    "anime coloring", "manga coloring", "flat coloring", "soft coloring", "rough coloring", "gradient coloring",
    "cel coloring", "cell shading", "cel shading", "flat shading", "soft shading", "smooth shading",
    "hard shading", "dramatic shading", "realistic shading", "painterly rendering", "cel rendering",
    "realistic rendering", "stylized rendering", "toon rendering", "3d rendering", "physically based rendering",
    "hand painted rendering", "matte painting", "photorealistic", "hyperrealistic", "semi realistic",
    "stylized realism", "illustrative realism", "anime art", "manga art", "comic art", "webtoon art",
    "manhwa art", "western comics", "silent comic", "graphic novel art", "chibi art", "toon art",
    "cartoon art", "storybook art", "fairy tale art", "fantasy art", "dark fantasy art", "sci fi art",
    "cyberpunk art", "steampunk art", "vaporwave art", "synthwave art", "minimalist art", "maximalist art",
    "abstract art", "surrealist art", "expressionist art", "impressionist art", "cubist art", "pop art",
    "fine art style", "art nouveau", "art deco", "ukiyo-e", "woodblock style", "ink wash style",
    "retro artstyle", "faux retro artstyle", "vintage illustration", "modern illustration", "experimental art",
    "naive art style", "folk art style", "gothic art", "baroque art", "rococo art", "romanticism art",
    "symbolist art", "constructivist art", "bauhaus design", "memphis design", "brutalist design",
)

COLORING = (
    "monochrome", "greyscale", "grayscale", "black and white", "duotone", "tritone", "limited palette",
    "restricted palette", "pastel palette", "muted palette", "neon palette", "warm palette", "cool palette",
    "earth tone palette", "jewel tone palette", "candy color palette", "vibrant palette", "soft palette",
    "dark palette", "bright palette", "high contrast", "low contrast", "desaturated colors", "saturated colors",
    "vibrant colors", "muted colors", "pastel colors", "pale colors", "dark colors", "bright colors",
    "warm colors", "cool colors", "neutral colors", "earth tones", "jewel tones", "candy colors",
    "complementary colors", "analogous colors", "triadic colors", "split complementary colors", "primary colors",
    "secondary colors", "tertiary colors", "rainbow gradient", "iridescent colors", "metallic colors",
    "fluorescent colors", "neon colors", "acid colors", "dusty colors", "faded colors", "vintage colors",
    "cinematic color grading", "film color grading", "teal and orange color grading", "color harmony",
    "color blocking", "spot color", "flat color", "gradient colors", "two-tone colors", "multicolored",
    "colorful", "sepia tone", "warm tone", "cool tone", "soft tone", "high key colors", "low key colors",
)

LIGHTING = (
    "cinematic lighting", "dramatic lighting", "soft lighting", "hard lighting", "diffuse lighting",
    "ambient lighting", "atmospheric lighting", "volumetric lighting", "global illumination", "ambient occlusion",
    "rim lighting", "backlighting", "sidelighting", "underlighting", "top lighting", "bottom lighting",
    "studio lighting", "portrait lighting", "stage lighting", "gallery lighting", "golden hour", "blue hour",
    "sunlight", "moonlight", "candlelight", "firelight", "neon lighting", "bioluminescent lighting",
    "fluorescent lighting", "incandescent lighting", "overcast lighting", "dappled sunlight", "window light",
    "bounce light", "reflected light", "colored light", "split lighting", "butterfly lighting", " Rembrandt lighting",
    "high key lighting", "low key lighting", "chiaroscuro", "tenebrism", "light rays", "god rays", "light shafts",
    "light bloom", "lens flare", "anamorphic flare", "afterglow", "glow effect", "outer glow", "inner glow",
    "soft shadow", "hard shadow", "cast shadow", "long shadow", "colored shadow", "drop shadow", "silhouette",
    "bokeh", "depth blur", "motion blur", "film glow", "dream glow", "haze lighting", "fog lighting",
)

LINEWORK = (
    "clean lineart", "rough lineart", "thin lineart", "thick lineart", "bold lineart", "delicate lineart",
    "sketch lineart", "colored lineart", "monochrome lineart", "no lineart", "expressive lineart", "loose lineart",
    "precise lineart", "calligraphic lineart", "technical lineart", "ink lineart", "brush lineart", "pencil lineart",
    "pen lineart", "mechanical pencil lineart", "variable line weight", "uniform line weight", "broken lineart",
    "gestural lineart", "contour lineart", "crosshatching", "cross hatching", "hatching", "fine hatching",
    "rough hatching", "parallel hatching", "stipple shading", "stippling", "dotwork", "dithering", "screentones",
    "halftone", "ben-day dots", "ink splatter", "paint splatter", "dry brush texture", "visible brushwork",
    "painterly brushwork", "impasto brushwork", "sketch", "rough sketch", "quick sketch", "gesture drawing",
    "design sketch", "concept sketch", "colored sketch", "monochrome sketch", "painterly sketch", "doodle art",
)

TEXTURES = (
    "paper texture", "watercolor paper", "rough paper texture", "smooth paper texture", "canvas texture",
    "linen texture", "newsprint texture", "parchment texture", "rice paper texture", "grain texture",
    "film grain", "heavy film grain", "fine film grain", "analog grain", "digital noise", "subtle noise",
    "paint texture", "brush texture", "dry paint texture", "wet paint texture", "ink texture", "pencil texture",
    "charcoal texture", "pastel texture", "chalk texture", "crayon texture", "matte texture", "glossy texture",
    "metallic texture", "iridescent texture", "rough texture", "smooth texture", "soft texture", "gritty texture",
    "distressed texture", "weathered texture", "fabric texture", "wood texture", "stone texture", "glass texture",
    "watercolor effect", "ink wash effect", "paint wash effect", "color bleed", "wet-on-wet", "dry-on-dry",
    "paper grain", "canvas grain", "print texture", "screenprint texture", "risograph texture", "photocopy texture",
    "halftone texture", "screentone texture", "pixel texture", "dither texture", "scanline texture",
)

ERA_AND_FORMAT = (
    "1920s art deco", "1930s illustration", "1940s poster art", "1950s retro art", "1960s pop art",
    "1970s retro art", "1980s anime style", "1990s anime style", "2000s anime style", "heisei retro",
    "early digital art", "late digital art", "classic anime style", "modern anime style", "contemporary illustration",
    "retro manga style", "vintage manga style", "golden age comics", "silver age comics", "bronze age comics",
    "visual novel art", "visual novel cg", "visual novel sprite", "game cg style", "key visual art",
    "splash art", "poster art", "cover art", "editorial art", "gallery art", "fine art illustration",
    "storybook style", "picture book style", "fashion editorial style", "concept art style", "production art style",
    "animation cel style", "limited animation style", "comic book style", "graphic novel style", "webcomic style",
)

SYNTHETIC_ADJECTIVES = (
    "soft", "hard", "bold", "delicate", "loose", "expressive", "polished", "vibrant", "muted", "pastel",
    "luminous", "moody", "dramatic", "atmospheric", "cinematic", "dreamy", "ethereal", "graphic", "minimal",
    "maximalist", "retro", "vintage", "modern", "experimental", "stylized", "realistic", "surreal", "abstract",
    "detailed", "intricate", "clean", "rough", "textured", "flat", "smooth", "high contrast", "low contrast",
    "warm", "cool", "dark", "bright", "airy", "rich", "subtle", "ornate", "whimsical", "nostalgic",
)

SYNTHETIC_BASES = (
    "watercolor", "ink wash", "oil paint", "acrylic paint", "gouache", "colored pencil", "graphite", "charcoal",
    "pastel", "marker", "airbrush", "brush pen", "lineart", "cel shading", "soft shading", "hard shading",
    "anime coloring", "manga coloring", "flat coloring", "gradient coloring", "painterly rendering", "cel rendering",
    "realistic rendering", "pixel art", "vector art", "concept art", "editorial illustration", "poster art",
    "fine art", "ukiyo-e", "art nouveau", "art deco", "impressionism", "expressionism", "surrealism", "cubism",
    "pop art", "minimalism", "gothic art", "vaporwave", "synthwave", "cyberpunk", "steampunk", "fantasy art",
    "dark fantasy", "storybook art", "comic art", "western comics", "webtoon art", "manhwa art", "anime art",
    "manga art", "chibi art", "toon art", "monochrome", "duotone", "limited palette", "pastel palette",
    "muted palette", "neon palette", "warm palette", "cool palette", "sepia tone", "cinematic lighting",
    "dramatic lighting", "soft lighting", "volumetric lighting", "rim lighting", "backlighting", "moonlight",
    "candlelight", "neon lighting", "chiaroscuro", "light bloom", "lens flare", "bokeh", "paper texture",
    "canvas texture", "film grain", "halftone", "crosshatching", "stipple shading", "dithering", "ink splatter",
    "paint splatter", "dry brush texture", "rough lineart", "clean lineart", "colored lineart", "sketch lineart",
)


def fetch_online() -> dict[str, int]:
    # The read endpoint is public.  An optional key can be supplied for users
    # with a Danbooru rate-limit allowance, but it is never written to output.
    api_key = os.environ.get("DANBOORU_API_KEY", "").strip()
    collected: dict[str, int] = {}
    for pattern in ONLINE_PATTERNS:
        query_params = {
            "search[name_matches]": pattern,
            "search[category]": 0,
            "search[order]": "count",
            "limit": 1000,
        }
        if api_key:
            query_params["api_key"] = api_key
        query = urllib.parse.urlencode(query_params)
        request = urllib.request.Request(
            f"{DANBOORU_TAGS_URL}?{query}",
            headers={"Accept": "application/json", "User-Agent": "novelai-style-evolver/1.0"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            records = json.load(response)
        for record in records:
            tag = normalize(record.get("name", ""))
            count = int(record.get("post_count", 0) or 0)
            if not tag or count < 20 or EXCLUDED.search(tag) or not INCLUDED.search(tag):
                continue
            collected[tag] = max(count, collected.get(tag, 0))
    return collected


def add_item(items: dict[str, dict], tag: str, source: str = "curated-synthetic", post_count: int | None = None, category: str | None = None, allow_curated_excluded: bool = False) -> None:
    normalized = normalize(tag)
    if not normalized or normalized in items or (EXCLUDED.search(normalized) and not allow_curated_excluded):
        return
    items[normalized] = {
        "tag": normalized,
        "category": category or category_for(normalized),
        "polarity": "negative" if category == "negative" else "positive",
        "source": source,
        "postCount": post_count,
    }


def add_seed_item(items: dict[str, dict], item: dict) -> None:
    """Keep a committed seed exactly, including deliberate negative tags."""
    normalized = normalize(item.get("tag", ""))
    if not normalized:
        return
    items[normalized] = {
        "tag": normalized,
        "category": item.get("category") or category_for(normalized),
        "polarity": item.get("polarity", "positive"),
        "source": item.get("source", "nai-or-user"),
        "postCount": item.get("postCount"),
    }


def build(target: int) -> dict:
    original = json.loads((DATA_DIR / "style-tags.seed.json").read_text(encoding="utf-8"))
    items: dict[str, dict] = {}
    for item in original["tags"]:
        add_seed_item(items, item)
    for year in range(2000, 2027):
        add_item(items, f"year {year}", "nai-official", None, "year")

    online = fetch_online()
    for tag, count in sorted(online.items(), key=lambda pair: (-pair[1], pair[0])):
        add_item(items, tag, "danbooru-general-curated", count)
        if len(items) >= target:
            break

    for collection in (QUALITY, AESTHETIC, MEDIUMS, RENDERING, COLORING, LIGHTING, LINEWORK, TEXTURES, ERA_AND_FORMAT):
        for tag in collection:
            add_item(items, tag, allow_curated_excluded=True)
    for adjective in SYNTHETIC_ADJECTIVES:
        for base in SYNTHETIC_BASES:
            add_item(items, f"{adjective} {base}")
            if len(items) >= target:
                break
        if len(items) >= target:
            break

    if len(items) < target:
        raise RuntimeError(f"只建立 {len(items)} 個風格詞，低於目標 {target}。")
    selected = sorted(items.values(), key=lambda item: (item["category"], item["tag"]))[:target]
    # Retain every committed seed item even when a smaller target is requested.
    required = {normalize(item["tag"]) for item in original["tags"]}
    missing = required - {item["tag"] for item in selected}
    if missing:
        selected = [items[tag] for tag in sorted(required)] + [item for item in selected if item["tag"] not in required]
        selected = selected[:target]
    categories = dict(original["categories"])
    categories.update({
        "coloring": {"label": "上色與色盤", "max": 3},
        "lighting": {"label": "光線", "max": 3},
        "linework": {"label": "線稿", "max": 3},
        "texture": {"label": "紋理", "max": 2},
        "rendering": {"label": "渲染", "max": 3},
    })
    return {
        "version": 3,
        "targetCount": target,
        "source": "Danbooru public tags API + curated style vocabulary",
        "minimumPostCount": 20,
        "metadataPolicy": "rendering-curated",
        "categories": categories,
        "tags": selected,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=int, default=1000)
    parser.add_argument("--output", type=Path, default=DATA_DIR / "style-tags.seed.json")
    args = parser.parse_args()
    result = build(args.target)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已建立 {len(result['tags'])} 個風格詞，線上來源為 Danbooru general tags。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
