function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export class GitHubClient {
  private readonly base = 'https://api.github.com';
  private readonly headers: Record<string, string>;

  constructor(
    token: string,
    private readonly repo: string,
  ) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'telegram-notetaker',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/repos/${this.repo}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async getFileSha(path: string, branch: string): Promise<string | null> {
    try {
      const data = await this.req<{ sha: string }>(
        'GET',
        `/contents/${encodeURIComponent(path)}?ref=${branch}`,
      );
      return data.sha;
    } catch (e) {
      if ((e as Error).message.includes('404')) return null;
      throw e;
    }
  }

  async upsertFile(path: string, content: string, message: string, branch: string): Promise<void> {
    const sha = await this.getFileSha(path, branch);
    await this.req('PUT', `/contents/${encodeURIComponent(path)}`, {
      message,
      content: toBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  async getFileContent(path: string, branch: string): Promise<string | null> {
    try {
      const data = await this.req<{ content: string }>(
        'GET',
        `/contents/${encodeURIComponent(path)}?ref=${branch}`,
      );
      return fromBase64(data.content);
    } catch (e) {
      if ((e as Error).message.includes('404')) return null;
      throw e;
    }
  }

  async getBranchRef(branch: string): Promise<{ commitSha: string; treeSha: string }> {
    const ref = await this.req<{ object: { sha: string } }>(
      'GET',
      `/git/refs/heads/${branch}`,
    );
    const commit = await this.req<{ tree: { sha: string } }>(
      'GET',
      `/git/commits/${ref.object.sha}`,
    );
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  async createBlob(content: string): Promise<string> {
    const res = await this.req<{ sha: string }>('POST', '/git/blobs', {
      content: toBase64(content),
      encoding: 'base64',
    });
    return res.sha;
  }

  async createTree(
    entries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>,
    baseTreeSha: string,
  ): Promise<string> {
    const res = await this.req<{ sha: string }>('POST', '/git/trees', {
      tree: entries,
      base_tree: baseTreeSha,
    });
    return res.sha;
  }

  async createCommit(message: string, treeSha: string, parentSha: string): Promise<string> {
    const res = await this.req<{ sha: string }>('POST', '/git/commits', {
      message,
      tree: treeSha,
      parents: [parentSha],
    });
    return res.sha;
  }

  async updateRef(branch: string, sha: string): Promise<void> {
    await this.req('PATCH', `/git/refs/heads/${branch}`, { sha });
  }
}
