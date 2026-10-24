// Genera projects.json con los repos públicos de GitHub y su último release.
// Uso: node scripts/fetch-projects.mjs   (Node 18+)
// Variables opcionales: GH_USER, GITHUB_TOKEN, EXCLUDE (nombres separados por coma)
// GH_PAT: token personal con lectura de tus repos. Sin él solo se listan los públicos;
//         con él también los privados que tengan el topic INCLUDE_TOPIC (y un homepage).

import { writeFile } from 'node:fs/promises';

const USER = process.env.GH_USER || 'gabrielhro10';
const PAT = process.env.GH_PAT;
const TOKEN = PAT || process.env.GITHUB_TOKEN;
const INCLUDE_TOPIC = process.env.INCLUDE_TOPIC || 'portfolio';
const EXCLUDE = new Set(
    (process.env.EXCLUDE || `Portafolio,${USER},${USER}.github.io`)
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
);

const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'portafolio-generator',
    ...(TOKEN && { Authorization: `Bearer ${TOKEN}` })
};

async function gh(path) {
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status} en ${path}: ${await res.text()}`);
    return res.json();
}

async function listRepos() {
    const all = [];
    for (let page = 1; ; page++) {
        const path = PAT
            ? `/user/repos?affiliation=owner&sort=updated&per_page=100&page=${page}`
            : `/users/${USER}/repos?type=owner&sort=updated&per_page=100&page=${page}`;
        const batch = await gh(path);
        if (!batch?.length) break;
        all.push(...batch);
        if (batch.length < 100) break;
    }
    return all;
}

// Lee el manifest PWA de la app desplegada (icono, nombre, descripción). Si algo falla, devuelve {}.
async function readManifest(homepage) {
    if (!homepage) return {};
    try {
        const base = new URL(homepage);
        const html = await fetch(base, { signal: AbortSignal.timeout(10000) }).then(r => (r.ok ? r.text() : ''));
        const href = html.match(/<link[^>]+rel=["']manifest["'][^>]*>/i)?.[0].match(/href=["']([^"']+)["']/i)?.[1];
        const manifestUrl = new URL(href || 'manifest.webmanifest', base);
        const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return {};
        const m = await res.json();

        // Prefiere icono "any" (no maskable), PNG y de tamaño cercano a 192; el SVG queda como último recurso.
        const score = i => {
            if (/maskable/.test(i.purpose || '') && !/any/.test(i.purpose)) return -1;
            if (/svg/.test(i.type || '') || i.sizes === 'any') return 1;
            return 1000 - Math.abs(parseInt(i.sizes, 10) - 192);
        };
        const best = (m.icons || []).filter(i => score(i) >= 0).sort((a, b) => score(b) - score(a))[0];
        return {
            icon: best ? new URL(best.src, manifestUrl).href : null,
            title: m.name || m.short_name || null,
            description: m.description || null
        };
    } catch {
        return {};
    }
}

// Públicos: todos. Privados: solo con el topic de inclusión y una URL de despliegue.
const repos = (await listRepos()).filter(r => {
    if (r.fork || r.archived || EXCLUDE.has(r.name.toLowerCase())) return false;
    if (!r.private) return true;
    return Boolean(r.homepage) && (r.topics || []).includes(INCLUDE_TOPIC);
});

const projects = await Promise.all(
    repos.map(async r => {
        // Los repos privados no exponen enlaces a GitHub (darían 404 a los visitantes).
        const release = r.private ? null : await gh(`/repos/${USER}/${r.name}/releases/latest`);
        const pagesUrl = r.has_pages && !r.private ? `https://${USER}.github.io/${r.name}/` : null;
        const homepage = r.homepage || pagesUrl;
        const manifest = await readManifest(homepage);
        return {
            name: r.name,
            title: manifest.title || r.name,
            description: r.description || manifest.description || '',
            icon: manifest.icon || null,
            url: r.private ? null : r.html_url,
            homepage,
            language: r.language,
            topics: (r.topics || []).filter(t => t !== INCLUDE_TOPIC),
            stars: r.private ? 0 : r.stargazers_count,
            updatedAt: r.pushed_at,
            version: release?.tag_name ?? null,
            releaseUrl: release?.html_url ?? null
        };
    })
);

projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

await writeFile(
    new URL('../projects.json', import.meta.url),
    JSON.stringify({ user: USER, generatedAt: new Date().toISOString(), projects }, null, 2) + '\n'
);

console.log(`projects.json: ${projects.length} proyectos de ${USER}`);
