// SEO, AEO and GEO files, generated from the content so they never drift (docs/device-design.md §47, §62):
//   index.html, between the seo markers     JSON-LD (@graph) + prerendered works/events/bio for non-JS crawlers
//   public/llms.txt, public/llms-full.txt   plain-text maps & Q&A for AI assistants and answer engines
//   public/sitemap.xml                      the page and its key images, with today's date
// Runs before every build (npm run build) and by hand: node scripts/seo/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'https://www.dean-fi.my/';
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const data = JSON.parse(read('src/content/portfolio.json'));
let html = read('index.html');
const title = html.match(/<title>([^<]*)<\/title>/)[1];
const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
const abs = (p) => new URL(p, SITE).href;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const today = new Date().toISOString().slice(0, 10);

// Facts about Dean: mirror src/content/portfolio.ts; no email, no phone, no full name, no invented base location.
const DEAN = {
  jobTitle: 'AI-native designer and frontend developer',
  roles: ['AI Native UI/UX Designer', 'Frontend Developer', 'Creative Designer'],
  bio: [
    'An AI-native designer who also ships the frontend, so design goes straight into the build with no handoff in between. UI/UX and creative design for user interfaces, landing pages and frontend builds that are easy to understand.',
    'An experienced Web3 and blockchain speaker and presenter who also teaches Web3 topics.',
  ],
  knowsAbout: [
    'AI-native design',
    'UI/UX design',
    'Frontend development',
    'Creative design',
    'Design systems',
    'Web3',
    'Blockchain',
    'DeFi',
    'Three.js',
    'Next.js',
    'Public speaking',
  ],
  knowsLanguage: ['English', 'Mandarin Chinese', 'Bahasa Melayu'],
  languages: ['English', 'Mandarin', 'Bahasa Melayu'],
  tools: ['Figma', 'Photoshop', 'Gemini', 'Claude', 'Codex'],
  sameAs: ['https://www.linkedin.com/in/hasnuddin/'],
  services: [
    'UI/UX design',
    'Frontend development',
    'Creative design',
    'Design systems',
    'Web3 product design',
    'Landing pages',
    'Dapp prototyping',
  ],
  workflow: {
    intro: "Six steps from a client's brief to a shipped site, with AI agents doing the building.",
    steps: [
      { title: 'Brief', text: "I start with the client: what the site is for, who it's for and the look they have in mind." },
      { title: 'Ideation', text: 'I turn the brief into a direction, with references from Pinterest, open-source libraries and marketplaces, until a design and theme fit.' },
      {
        title: 'Framework',
        text: 'Before any code, I brief the AI agent (Claude, Codex or Antigravity) on the project.',
        subs: [
          { title: 'Skills', text: 'I install the skills.md files the build needs, before anything else.' },
          { title: 'Design system', text: 'The agent sets up the design system and tokens first.' },
          { title: 'Motion', text: 'I decide the motion, interactions and micro-interactions.' },
          { title: 'Prompting', text: "I prompt, review and refine, and repeat until it's right." },
        ],
      },
      { title: 'Prototype', text: 'A working build comes early, on localhost or deployed to free hosting such as Vercel, GitHub Pages or Netlify.' },
      { title: 'Iteration', text: 'Any change to ideas, design or direction happens here.' },
      { title: 'Ship', text: "Once the design and functionality work as intended, it's complete and deployed for the client." },
    ],
    closing: 'AI speeds up the work. A human still steers it.',
  },
};

// Every work in rank order: the first SELECTED are the selected works, the rest sit on the archive cartridge.
const SELECTED = 5; // keep in step with SELECTED_COUNT in src/content/portfolio.ts
const works = [...data.projects.map((p) => ({ ...p, kind: 'Web' })), ...data.apps.map((p) => ({ ...p, kind: 'Mobile app' }))].sort((a, b) => a.rank - b.rank);
const countries = { CN: 'China', ID: 'Indonesia', MY: 'Malaysia' };

// ---------------------------------------------------------------- JSON-LD (@graph)
const work = (p, i) => ({
  '@type': 'ListItem',
  position: i + 1,
  item: {
    '@type': 'CreativeWork',
    name: p.title,
    url: p.link,
    description: p.description,
    genre: p.category,
    keywords: [...new Set([...p.tags, ...p.stack, ...(p.chain ? [p.chain.name] : [])])].join(', '),
    image: abs(p.images[0]),
    creator: { '@id': SITE + '#dean' },
    ...(p.original ? { isBasedOn: p.original.link } : {}),
  },
});

const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': SITE + '#website',
      url: SITE,
      name: 'Dean Studio',
      description,
      inLanguage: 'en',
      publisher: { '@id': SITE + '#dean' },
    },
    {
      '@type': 'ProfilePage',
      '@id': SITE + '#webpage',
      url: SITE,
      name: title,
      description,
      inLanguage: 'en',
      dateModified: today,
      isPartOf: { '@id': SITE + '#website' },
      mainEntity: { '@id': SITE + '#dean' },
      about: { '@id': SITE + '#studio' },
    },
    {
      '@type': 'Person',
      '@id': SITE + '#dean',
      name: 'Dean',
      url: SITE,
      mainEntityOfPage: { '@id': SITE + '#webpage' },
      image: abs('media/dean-portrait.webp'),
      jobTitle: DEAN.jobTitle,
      description: DEAN.bio.join(' '),
      knowsAbout: DEAN.knowsAbout,
      knowsLanguage: DEAN.knowsLanguage,
      sameAs: DEAN.sameAs,
      worksFor: { '@id': SITE + '#studio' },
    },
    {
      '@type': 'ProfessionalService',
      '@id': SITE + '#studio',
      name: 'Dean Studio',
      url: SITE,
      logo: abs('icon-512.png'),
      image: abs('og-image.jpg'),
      description,
      founder: { '@id': SITE + '#dean' },
      serviceType: DEAN.services,
    },
    {
      '@type': 'ItemList',
      '@id': SITE + '#works',
      name: 'Works',
      numberOfItems: works.length,
      itemListElement: works.map(work),
    },
  ],
};

const replaceMarker = (src, tag, inner) => {
  const re = new RegExp(`(<!-- ${tag}:start -->)[\\s\\S]*?(<!-- ${tag}:end -->)`);
  if (!re.test(src)) return src;
  return src.replace(re, `$1${inner}$2`);
};

const block = `<!-- seo:start (generated by scripts/seo/generate.mjs: edit the content, not this) -->\n  <script type="application/ld+json">${JSON.stringify(graph)}</script>\n  <!-- seo:end -->`;
const marked = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;
const legacy = /<script type="application\/ld\+json">[\s\S]*?<\/script>/;
let next = marked.test(html) ? html.replace(marked, block) : html.replace(legacy, block);
next = replaceMarker(
  next,
  'seo:works',
  works.map((p) => `<li><a href="#/work/${esc(p.id)}">${esc(p.title)}</a></li>`).join(''),
);
next = replaceMarker(
  next,
  'seo:events',
  data.events.map((e) => `<li><a href="#/stage/${esc(e.id)}">${esc(e.place)}: ${esc(e.title)}</a></li>`).join(''),
);
next = replaceMarker(next, 'seo:bio', esc(DEAN.bio.join(' ')));
if (next !== html) writeFileSync(join(ROOT, 'index.html'), next);

// ---------------------------------------------------------------- llms.txt
const NL = String.fromCharCode(10);
const line = (p) => `- [${p.title}](${p.link}): ${p.category}. ${p.stack.join(', ')}.${p.flagship ? ' Flagship project.' : ''}`;
const entry = (p) =>
  `${line(p)}${
    p.kind === 'Mobile app'
      ? ` Mobile app prototype on ${p.chain?.name ?? 'testnet'}${p.original ? ` (production app: ${p.original.link})` : ''}.`
      : ''
  }`;

const llms = `# Dean Studio

> ${description}

Dean Studio is the portfolio of Dean, an AI-native UI/UX designer and frontend developer. The site is an interactive 3D hardware-wallet-style device: its screen holds the works, events, about and contact; a plain List view shows the same content as a normal page. Site: ${SITE}

## Profile & capabilities
- Roles: ${DEAN.roles.join(', ')}
- Services: ${DEAN.services.join(', ')}
- Tools: ${DEAN.tools.join(', ')}
- Languages: ${DEAN.languages.join(', ')}
- Workflow: ${DEAN.workflow.steps.map((s) => s.title).join(' > ')} ("${DEAN.workflow.closing}")

## Selected works
${works.slice(0, SELECTED).map(entry).join('\n')}

## More projects
${works.slice(SELECTED).map(entry).join('\n')}

## Events
${data.events.map((e) => `- ${e.title} (${e.place}, ${countries[e.country] ?? e.country}, ${e.role}): ${e.description.split('. ')[0]}.`).join('\n')}

## More
- [Full detail of every work, workflow and event](${SITE}llms-full.txt)
- [LinkedIn](${DEAN.sameAs[0]})
- Contact: through the Get in touch section of ${SITE}
`;
writeFileSync(join(ROOT, 'public/llms.txt'), llms);

// ---------------------------------------------------------------- llms-full.txt
const workflowText = DEAN.workflow.steps
  .map((s) => {
    const subs = s.subs ? '\n' + s.subs.map((sub) => `  - ${sub.title}: ${sub.text}`).join('\n') : '';
    return `- ${s.title}: ${s.text}${subs}`;
  })
  .join('\n');

const quickAnswers = [
  {
    q: 'Who is behind Dean Studio?',
    a: `Dean is an AI-native UI/UX designer, frontend developer and creative designer who ships design straight into production code without handoffs. He also speaks, presents and teaches on Web3 and blockchain topics.`,
  },
  {
    q: 'What services does Dean Studio offer?',
    a: `UI/UX design, frontend development, creative design, design systems, Web3 product design, landing pages and dapp prototyping.`,
  },
  {
    q: 'How does Dean use AI in design and frontend builds?',
    a: `${DEAN.workflow.intro} Steps: ${DEAN.workflow.steps.map((s) => s.title).join(' > ')}. Before writing code, Dean briefs AI agents (Claude, Codex or Antigravity) with skills.md files, sets up design tokens and systems first, directs motion and micro-interactions, and iterates through working prototypes. "${DEAN.workflow.closing}"`,
  },
  {
    q: 'What Web3 and AI projects has Dean shipped?',
    a: `${works.length} portfolio works across Web3, DeFi, AI and corporate sites, including ${works
      .slice(0, SELECTED)
      .map((p) => `${p.title} (${p.category})`)
      .join(', ')}, plus ${works
      .slice(SELECTED)
      .map((p) => p.title)
      .join(', ')}.`,
  },
  {
    q: 'What languages does Dean speak and what speaking work has he done?',
    a: `Dean speaks ${DEAN.languages.join(', ')} and has spoken, hosted or presented at ${data.events.length} events across Malaysia, China and Indonesia, including the Selangor AI & Semiconductor Summit 2026, ENI DeFi Week World Tour (Changsha), Web3 + RWA Global Infrastructure Summit (Hangzhou) and Monster GameFi Soft Launch (Bali).`,
  },
];

const full = `# Dean Studio, in full

> ${description}

Dean: ${DEAN.bio.join(' ')}

Roles: ${DEAN.roles.join(', ')}.
Services: ${DEAN.services.join(', ')}.
Tools: ${DEAN.tools.join(', ')}.
Languages: ${DEAN.languages.join(', ')}.
Knows about: ${DEAN.knowsAbout.join(', ')}.
Profile: ${DEAN.sameAs[0]}
Site: ${SITE}

## How Dean works
${DEAN.workflow.intro}
${workflowText}
Closing principle: "${DEAN.workflow.closing}"

## Works

${works
  .map(
    (p) => `### ${p.title} (${p.kind})
- Category: ${p.category}
- Status: ${p.status}
- Live: ${p.link}${p.original ? `\n- Production app: ${p.original.link}` : ''}
- Roles: ${p.roles.join(', ')}${p.tools.length ? `\n- Tools: ${p.tools.join(', ')}` : ''}
- Tech stack: ${p.stack.join(', ')}${p.chain ? `\n- Network: ${p.chain.name}` : ''}
- Process: ${p.flow.steps.join(' > ')}${p.flagship ? NL + '- Flagship project' : ''}
${p.description}
${p.story.map((x) => `${x.label}: ${x.text}`).join(NL)}`,
  )
  .join('\n\n')}

## Events

${data.events
  .map(
    (e) =>
      `### ${e.title}\n- Where: ${e.place}, ${countries[e.country] ?? e.country}\n- Role: ${e.role}${
        e.links ? `\n- Links: ${e.links.map((l) => `${l.title} ${l.link}`).join(', ')}` : ''
      }\n${e.description}\nConclusion: ${e.conclusion}`,
  )
  .join('\n\n')}

## Quick answers (GEO)

${quickAnswers.map((item) => `### ${item.q}\n${item.a}`).join('\n\n')}
`;
writeFileSync(join(ROOT, 'public/llms-full.txt'), full);

// ---------------------------------------------------------------- sitemap
const sitemapImages = [
  { loc: abs('og-image.jpg'), title: 'Dean Studio' },
  { loc: abs('media/dean-portrait.webp'), title: 'Dean speaking on stage' },
  ...works.slice(0, SELECTED).map((p) => ({ loc: abs(p.images[0]), title: `${p.title} — ${p.category}` })),
];

writeFileSync(
  join(ROOT, 'public/sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
${sitemapImages.map((img) => `    <image:image><image:loc>${esc(img.loc)}</image:loc><image:title>${esc(img.title)}</image:title></image:image>`).join('\n')}
  </url>
</urlset>
`,
);
console.log(`seo: ${works.length} works, ${data.events.length} events, ${sitemapImages.length} images, JSON-LD ${JSON.stringify(graph).length} bytes, sitemap ${today}`);
