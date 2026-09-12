// Hand-reviewed semantic families. Original tags/categories remain unchanged
// so existing preference keys and save points still refer to the same words.
export const STYLE_LAYERS = {
  medium: "介質感", shading: "光影結構", color: "色彩簽名", auxiliary: "附加控制"
};

const groups = [
  ["medium", "medium", `digital art|digital painting|digital illustration|clean digital art|traditional painting|oil painting|oil paint|acrylic paint|acrylic painting|watercolor|watercolor (medium)|watercolor painting|gouache|gouache painting|ink (medium)|ink|ink painting|ink wash|ink wash painting|ink wash style|sumi-e|colored pencil|watercolor pencil (medium)|graphite|graphite (medium)|graphite drawing|charcoal|charcoal drawing|pastel|pastel drawing|chalk pastel|soft pastel|oil pastel|crayon drawing|marker|marker rendering|alcohol marker|copics|copics (medium)|airbrush|brush pen|pen (medium)|pen and ink|ballpoint pen|technical pen|mechanical pencil|casein painting|tempera painting|encaustic art|encaustic painting|mixed media|collage art|paper craft|paper cutout|cut paper illustration|linocut|woodblock print|woodblock style|screen print|risograph print|lithograph|etching|engraving|monotype|cyanotype|fresco painting|mosaic art|stained glass art|textile art|fabric art|embroidery art|needle felting|clay art|ceramic art|sculptural art|3d (medium)|3d art|3d rendering|low poly art|voxel art|pixel art|vector art|svg art|ascii art|generative art|animated (medium)`],
  ["medium", "line-presence", `lineart|no lineart|no outline|outlined|color-defined edges`],
  ["medium", "line-weight", `thin lineart|thick lineart|bold lineart|delicate lineart|variable line weight|uniform line weight|thin lines|thick outlines|fine lines`],
  ["medium", "line-technique", `clean lineart|rough lineart|sketch lineart|expressive lineart|loose lineart|precise lineart|calligraphic lineart|technical lineart|ink lineart|brush lineart|pencil lineart|pen lineart|mechanical pencil lineart|broken lineart|gestural lineart|contour lineart|crosshatching|cross hatching|hatching|fine hatching|rough hatching|parallel hatching|woven hatching|stippling|dotwork|dithering|screentones|halftone|ben-day dots|sketch|rough sketch|quick sketch|gesture drawing|design sketch|concept sketch|colored sketch|monochrome sketch|painterly sketch|doodle art`],
  ["medium", "brushwork", `calligraphy brush|dry brush|wet brush|visible brushwork|painterly brushwork|impasto brushwork|brushwork|brush texture|dry brush texture|ink splatter|paint splatter|paint texture|dry paint texture|wet paint texture|ink texture|pencil texture|charcoal texture|pastel texture|chalk texture|crayon texture|watercolor effect|ink wash effect|paint wash effect|color bleed|wet-on-wet|dry-on-dry`],
  ["medium", "surface", `paper texture|watercolor paper|rough paper texture|smooth paper texture|canvas texture|linen texture|newsprint texture|parchment texture|rice paper texture|paper grain|canvas grain|matte texture|glossy texture|metallic texture|iridescent texture|rough texture|smooth texture|soft texture|gritty texture|distressed texture|weathered texture|fabric texture|wood texture|stone texture|glass texture`],
  ["medium", "grain", `grain texture|film grain|heavy film grain|fine film grain|analog grain|digital noise|subtle noise|print texture|screenprint texture|risograph texture|photocopy texture|halftone texture|screentone texture|pixel texture|dither texture|scanline texture|glitch art`],
  ["medium", "art-language", `anime art|anime coloring|manga art|manga coloring|comic art|western comics|webtoon art|manhwa art|graphic novel art|chibi|chibi art|toon art|cartoon art|storybook art|fairy tale art|fantasy art|dark fantasy art|dark fantasy|sci fi art|cyberpunk art|cyberpunk|steampunk art|steampunk|vaporwave art|vaporwave|synthwave art|synthwave|minimalist art|minimalism|maximalist art|abstract art|surrealist art|surrealism|expressionist art|expressionism|impressionist art|impressionism|cubist art|cubism|pop art|fine art|fine art style|art nouveau|art deco|ukiyo-e|experimental art|naive art|naive art style|folk art|folk art style|outsider art|street art|graffiti art|gothic art|baroque art|rococo art|romanticism art|symbolist art|constructivist art|bauhaus design|memphis design|brutalist design|dunhuang style|greek painting style`],
  ["medium", "format", `concept art|concept art style|editorial illustration|fashion illustration|botanical illustration|scientific illustration|storybook illustration|children's book illustration|poster illustration|cover illustration|visual novel art|visual novel cg|visual novel sprite|visual novel chibi|game cg style|key visual art|splash art|poster art|cover art|editorial art|gallery art|fine art illustration|storybook style|picture book style|fashion editorial style|production art style|animation cel style|limited animation style|comic book style|graphic novel style|webcomic style|isometric illustration`],
  ["shading", "shadow-model", `cel shading|cell shading|cel coloring|flat shading|flat coloring|flat color|soft shading|smooth shading|hard shading|dramatic shading|realistic shading|gradient coloring|gradient shadow|airbrush shading|form shading|stylized shadow|stipple shading|halftone shadow|no shadow`],
  ["shading", "render-model", `painterly rendering|hand painted rendering|cel rendering|toon rendering|realistic rendering|stylized rendering|physically based rendering|matte painting|photorealistic|hyperrealistic|semi realistic|stylized realism|illustrative realism|rough coloring`],
  ["shading", "light-direction", `rim lighting|backlighting|sidelighting|underlighting|top lighting|bottom lighting|front lighting|split lighting|butterfly lighting|rembrandt lighting`],
  ["shading", "light-source", `studio lighting|portrait lighting|stage lighting|gallery lighting|golden hour|blue hour|sunlight|moonlight|candlelight|firelight|neon lighting|bioluminescent lighting|fluorescent lighting|incandescent lighting|overcast lighting|dappled sunlight|window light`],
  ["shading", "fill-light", `ambient lighting|global illumination|ambient occlusion|bounce light|reflected light|colored light`],
  ["shading", "light-softness", `soft lighting|hard lighting|diffuse lighting|soft shadow|hard shadow`],
  ["shading", "contrast", `high contrast|low contrast|high key lighting|low key lighting|chiaroscuro|tenebrism|cinematic lighting|dramatic lighting|complex lighting|dim lighting`],
  ["shading", "atmosphere", `atmospheric lighting|volumetric lighting|light rays|god rays|light shafts|haze lighting|fog lighting`],
  ["shading", "glow", `light bloom|lens flare|anamorphic flare|afterglow|glow effect|outer glow|inner glow|film glow|dream glow`],
  ["shading", "shadow-shape", `cast shadow|long shadow|drop shadow|window shadow|polka dot shadow|different shadow|ominous shadow|silhouette`],
  ["shading", "depth", `bokeh|depth blur|motion blur|depthness`],
  ["color", "palette", `monochrome|greyscale|grayscale|black and white|duotone|tritone|two-tone colors|limited palette|restricted palette|pastel palette|muted palette|neon palette|warm palette|cool palette|earth tone palette|jewel tone palette|candy color palette|vibrant palette|soft palette|dark palette|bright palette|neapolitan palette|multiple theme colors`],
  ["color", "saturation", `desaturated colors|saturated colors|vibrant colors|muted colors|pastel colors|pale colors|dark colors|bright colors|colorful|multicolored|dusty colors|faded colors`],
  ["color", "temperature", `warm colors|cool colors|neutral colors|warm tone|cool tone|soft tone|high key colors|low key colors|sepia tone`],
  ["color", "pigment", `earth tones|jewel tones|candy colors|iridescent colors|metallic colors|fluorescent colors|neon colors|acid colors|vintage colors|inverted colors`],
  ["color", "harmony", `complementary colors|analogous colors|triadic colors|split complementary colors|primary colors|secondary colors|tertiary colors|color harmony|color blocking|spot color|spot color (medium)|rainbow gradient|gradient colors|changing colors`],
  ["color", "grading", `cinematic color grading|film color grading|teal and orange color grading|movie tonal|pink color grading|teal color grading|split toning`],
  ["color", "shadow-hue", `colored shadow|cool shadows|warm shadows|purple shadows|blue-tinted shadows|magenta shadows|green-tinted shadows`],
  ["color", "line-hue", `colored lineart|monochrome lineart|black lineart|white outline|color-matched lines|multicolored lineart`],
  ["color", "mood", `dreamy aesthetic|cinematic aesthetic|atmospheric aesthetic|whimsical aesthetic|nostalgic aesthetic|ethereal aesthetic|moody aesthetic`],
  ["auxiliary", "quality", `best quality|amazing quality|great quality|normal quality|high quality render|production quality|professional illustration|polished illustration|refined artwork|clean finish|bad quality|worst quality`],
  ["auxiliary", "aesthetic", `masterpiece|top aesthetic|very aesthetic|aesthetic|pleasing aesthetic|beautiful aesthetic|elegant aesthetic|editorial aesthetic|stylized aesthetic|artistic aesthetic|cohesive aesthetic|visual harmony|balanced design|refined design|visual poetry|displeasing|very displeasing`],
  ["auxiliary", "detail", `absurdres|ultra detailed|highly detailed|intricate details|fine details|crisp details|ultra high detail|detail background`],
  ["auxiliary", "complexity", `high complexity|ultra complexity|medium complexity|low complexity`],
  ["auxiliary", "year", `1920s art deco|1930s illustration|1940s poster art|1950s retro art|1960s pop art|1970s retro art|1980s anime style|1990s anime style|2000s anime style|heisei retro|early digital art|late digital art|classic anime style|modern anime style|contemporary illustration|retro manga style|vintage manga style|golden age comics|silver age comics|bronze age comics|retro artstyle|faux retro artstyle|vintage illustration|modern illustration`],
  ["auxiliary", "suppression", `artist collaboration|multiple views|simple illustration`]
];

const lookup = new Map();
for (const [layer, facet, tags] of groups) {
  for (const tag of tags.split("|")) lookup.set(tag, { layer, facet, reviewed: true });
}

for (const tag of "soft coloring|alternate art style|expressive design|night vision effect|typographic art|x-ray film".split("|")) {
  const [layer, facet] = tag === "soft coloring" ? ["shading", "shadow-model"]
    : tag === "expressive design" ? ["auxiliary", "aesthetic"]
      : ["night vision effect", "x-ray film"].includes(tag) ? ["color", "grading"]
        : ["medium", tag === "typographic art" ? "medium" : "art-language"];
  lookup.set(tag, { layer, facet, reviewed: true });
}
const excluded = new Set(`paint palette|cinematic shot|ff gradient|froggy style|indian style|jungle style|flow glow (hololive)|grow glorious glow (project sekai)|living shadow|pov shadow|sitting in shadow|broken pencil|meta:golden era|meta:novel era|horizontal comic|left-to-right manga|right-to-left comic|segmented comic|silent comic|vertical scroll comic|visual novel bg`.split("|"));

export function classifyStyle(tag) {
  const normalized = String(tag).trim().toLowerCase();
  if (lookup.has(normalized)) return { ...lookup.get(normalized) };
  if (excluded.has(normalized)) return { layer: "auxiliary", facet: "custom", reviewed: true, enabled: false, reason: "內容、版面或語義不明，保留但預設不抽取" };
  if (/^year \d{4}$/u.test(normalized)) return { layer: "auxiliary", facet: "year", reviewed: true };
  // The existing synthetic pool uses these six prefixes. Only inherit from
  // an explicitly reviewed base, never from a keyword/category guess.
  const variant = normalized.match(/^(soft|hard|bold|delicate|loose|expressive) (.+)$/u);
  const base = variant && lookup.get(variant[2]);
  if (base) {
    const contradictory = (variant[1] === "hard" && /^(soft|smooth) /u.test(variant[2]))
      || (variant[1] === "soft" && /^hard /u.test(variant[2]));
    return { ...base, enabled: !contradictory, reason: contradictory ? "修飾詞相互矛盾，預設不抽取" : "" };
  }
  // Preserve non-rendering/ambiguous records for search, overrides and old
  // save points, but do not inject subject/layout words into new styles.
  return { layer: "auxiliary", facet: "custom", reviewed: false, enabled: false, reason: "內容、版面或語義不明，保留但預設不抽取" };
}

export function classifyStylePool(items) {
  return items.map((item) => ({ ...item, ...classifyStyle(item.tag) }));
}
