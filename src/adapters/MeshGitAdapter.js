/**
 * MeshGitAdapter — I/O adapter for the mesh p2p git HTTP daemon.
 *
 * URL patterns assume a simple REST layer in front of git smart-HTTP.
 * Adjust the URL templates to match the actual mesh HTTP API.
 *
 * Env var: MESH_BASE_URL (e.g. http://localhost:7979)
 */
export class MeshGitAdapter {
  constructor({ baseUrl }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /**
   * Fetch the raw content of a file at a given ref.
   * @param {string} repo   repository name / path
   * @param {string} path   file path within the repo
   * @param {string} [ref]  git ref (branch, tag, commit hash) — defaults to HEAD
   * @returns {Promise<string>} raw file content
   */
  async fetchRawFile(repo, path, ref = 'HEAD') {
    const url = `${this.baseUrl}/${encodeURIComponent(repo)}/raw/${ref}/${path}`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`mesh fetch failed for ${repo}/${path}@${ref}: ${res.status}`)
    }
    return res.text()
  }

  /**
   * Get the most recent commit hash that touched a file.
   * @param {string} repo
   * @param {string} path
   * @returns {Promise<string|null>} commit hash, or null if unavailable
   */
  async getLatestCommit(repo, path) {
    try {
      const url = `${this.baseUrl}/${encodeURIComponent(repo)}/log?path=${encodeURIComponent(path)}&limit=1`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      return data?.[0]?.hash ?? null
    } catch {
      return null
    }
  }
}
