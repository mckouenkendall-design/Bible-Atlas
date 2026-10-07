// All the words shown to the visitor live here, separate from the 3D code.
// Scripture text is the King James Version, which is in the public domain.
// To add another place to the atlas later, add another entry to LOCATIONS.

export const LOCATIONS = [
  {
    id: 'sermon-on-the-mount',
    name: 'Sermon on the Mount',
    ref: 'Matthew 5–7',
    // Mount of Beatitudes, the traditional site, on the north-west shore of the Sea of Galilee.
    lat: 32.8806,
    lon: 35.5556,
    place: 'Mount of Beatitudes, Galilee',
    scene: 'sermon',
  },
];

// Place names drawn on the globe. maxAlt / minAlt control at what zoom each one shows
// (alt is height above the ground measured in Earth radii, so 1 = about 6,400 km up).
export const LABELS = [
  { t: 'Mediterranean Sea', lat: 34.2, lon: 25.5, kind: 'sea', minAlt: 0.07, maxAlt: 1.6 },
  { t: 'Red Sea', lat: 21.0, lon: 38.0, kind: 'sea', minAlt: 0.1, maxAlt: 0.9 },
  { t: 'Egypt', lat: 26.8, lon: 29.6, kind: 'land', minAlt: 0.1, maxAlt: 1.0 },
  { t: 'Arabia', lat: 24.0, lon: 45.0, kind: 'land', minAlt: 0.12, maxAlt: 1.0 },
  { t: 'Mesopotamia', lat: 34.6, lon: 42.6, kind: 'land', minAlt: 0.08, maxAlt: 0.8 },
  { t: 'Asia Minor', lat: 39.0, lon: 33.0, kind: 'land', minAlt: 0.1, maxAlt: 0.9 },
  { t: 'Nile', lat: 28.6, lon: 31.7, kind: 'water', minAlt: 0.03, maxAlt: 0.3 },
  { t: 'The Great Sea', lat: 33.0, lon: 33.6, kind: 'sea', minAlt: 0.012, maxAlt: 0.07 },
  { t: 'Galilee', lat: 32.98, lon: 35.33, kind: 'land', minAlt: 0.004, maxAlt: 0.045 },
  { t: 'Samaria', lat: 32.25, lon: 35.2, kind: 'land', minAlt: 0.01, maxAlt: 0.045 },
  { t: 'Judea', lat: 31.55, lon: 34.98, kind: 'land', minAlt: 0.01, maxAlt: 0.045 },
  { t: 'Sea of Galilee', lat: 32.8, lon: 35.59, kind: 'water', minAlt: 0, maxAlt: 0.03 },
  { t: 'Jordan River', lat: 32.3, lon: 35.62, kind: 'water', minAlt: 0.004, maxAlt: 0.03 },
  { t: 'Dead Sea', lat: 31.5, lon: 35.47, kind: 'water', minAlt: 0.004, maxAlt: 0.045 },
  { t: 'Jerusalem', lat: 31.778, lon: 35.235, kind: 'town', minAlt: 0.003, maxAlt: 0.06 },
  { t: 'Bethlehem', lat: 31.705, lon: 35.2, kind: 'town', minAlt: 0.003, maxAlt: 0.012 },
  { t: 'Nazareth', lat: 32.7, lon: 35.3, kind: 'town', minAlt: 0.002, maxAlt: 0.02 },
  { t: 'Capernaum', lat: 32.881, lon: 35.575, kind: 'town', minAlt: 0, maxAlt: 0.006 },
];

export const SERMON_TEXT = {
  title: 'The Sermon on the Mount',
  sub: 'Matthew 5–7 · Galilee',
  version: 'King James Version',
  opening: [
    ['5:1', 'And seeing the multitudes, he went up into a mountain: and when he was set, his disciples came unto him:'],
    ['5:2', 'And he opened his mouth, and taught them, saying,'],
  ],
  beatitudes: [
    ['5:3', 'Blessed are the poor in spirit: for theirs is the kingdom of heaven.'],
    ['5:4', 'Blessed are they that mourn: for they shall be comforted.'],
    ['5:5', 'Blessed are the meek: for they shall inherit the earth.'],
    ['5:6', 'Blessed are they which do hunger and thirst after righteousness: for they shall be filled.'],
    ['5:7', 'Blessed are the merciful: for they shall obtain mercy.'],
    ['5:8', 'Blessed are the pure in heart: for they shall see God.'],
    ['5:9', 'Blessed are the peacemakers: for they shall be called the children of God.'],
    ['5:10', 'Blessed are they which are persecuted for righteousness’ sake: for theirs is the kingdom of heaven.'],
    ['5:11', 'Blessed are ye, when men shall revile you, and persecute you, and shall say all manner of evil against you falsely, for my sake.'],
    ['5:12', 'Rejoice, and be exceeding glad: for great is your reward in heaven: for so persecuted they the prophets which were before you.'],
  ],
  closing: [
    ['7:28', 'And it came to pass, when Jesus had ended these sayings, the people were astonished at his doctrine:'],
    ['7:29', 'For he taught them as one having authority, and not as the scribes.'],
  ],
  // A plain table of contents for the rest of the sermon. References only, no paraphrased teaching.
  outline: [
    ['5:13–16', 'Salt of the earth, light of the world'],
    ['5:17–48', 'The law and the prophets fulfilled'],
    ['6:1–18', 'Giving, praying and fasting in secret'],
    ['6:19–34', 'Treasures in heaven; take no thought for the morrow'],
    ['7:1–12', 'Judge not; ask, seek, knock'],
    ['7:13–23', 'The strait gate; known by their fruits'],
    ['7:24–27', 'The house built upon a rock'],
  ],
  fromScripture: [
    'Jesus saw the multitudes and went up into a mountain (5:1).',
    'He sat down to teach (5:1, “when he was set”).',
    'His disciples came to him (5:1).',
    'A crowd heard him and was astonished at his teaching (7:28).',
    'The crowds had followed him from Galilee, Decapolis, Jerusalem, Judea and beyond Jordan (4:25).',
    'Afterward he came down from the mountain and entered Capernaum (8:1, 8:5).',
  ],
  myChoices: [
    'The white robe, the glow and the shaft of light. Scripture does not describe his clothing here. These are markers so you can find him from any distance.',
    'The size of the crowd. Matthew says “multitudes” and gives no number. About 300 figures are shown.',
    'Twelve disciples seated nearest to him. Matthew says his disciples came to him but gives no count at this point. Luke 6:12–20 places the choosing of the twelve just before a similar sermon.',
    'Where the crowd sits. The text does not say whether they were below him, around him, or above him.',
    'The rock he sits on, the hand raised in teaching, the time of day and the weather.',
    'Clothing colours, the mix of men, women and children, and head coverings. Plausible for first-century Galilee, not stated.',
    'Wildflowers and birds. He points to both in the sermon (6:26, 6:28), which suggests they were in view, but the text does not say so.',
    'The fishing boats, the olive trees and the dark basalt stone. All fit the region. None are mentioned.',
    'The small village on the shore to the east. It stands where Capernaum lies. Matthew says he entered Capernaum after coming down (8:5), but does not describe the view.',
    'Distances are compressed. The real shoreline is about a kilometre from the traditional site, and the lake is closer here so it reads on a phone screen.',
  ],
  location: [
    'Matthew names no specific hill. He says only “a mountain” in Galilee.',
    'The pin marks the Mount of Beatitudes, above the north-west shore between Capernaum and Tabgha. Christians have pointed to this hillside since at least the fourth century. It is a tradition, not a confirmed site.',
    'Other proposals include the Horns of Hattin and Mount Arbel, both some kilometres to the south-west.',
    'Luke 6:17–49 records similar teaching given “in the plain”. Scholars disagree on whether that is the same occasion.',
    'The globe uses modern coastlines and the modern outline of the lake. Shorelines in the first century differed slightly.',
  ],
};
