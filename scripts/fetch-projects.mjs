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
        return {
            name: r.name,
            description: r.description || '',
            url: r.private ? null : r.html_url,
            homepage: r.homepage || pagesUrl,
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
