import { SpekoApiError } from '../errors.js';
import type { HttpClient } from '../http.js';
import type {
  KnowledgeBaseCreateParams,
  KnowledgeBaseDocumentCreateParams,
  KnowledgeBaseDocumentCreateResult,
  KnowledgeBaseDocumentPollOptions,
  KnowledgeBaseDocumentRow,
  KnowledgeBaseDocumentUploadParams,
  KnowledgeBaseListParams,
  KnowledgeBaseRow,
} from '../types/index.js';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

/**
 * Per-agent knowledge bases. Each KB owns documents that get embedded
 * into a Chroma collection so the agent can retrieve relevant chunks
 * during a call. Every agent created via {@link Agents.create}
 * auto-provisions a `Default` KB; additional KBs can be created
 * explicitly with {@link KnowledgeBases.create}.
 *
 * @example
 * ```ts
 * const kb = await speko.knowledgeBases.create({
 *   agentId: agent.id,
 *   name: 'Product FAQ',
 * });
 *
 * const doc = await speko.knowledgeBases.uploadDocument(kb.id, {
 *   filename: 'faq.md',
 *   contentType: 'text/markdown',
 *   data: await readFile('faq.md'),
 * });
 *
 * const ready = await speko.knowledgeBases.pollDocumentReady(kb.id, doc.id);
 * ```
 */
export class KnowledgeBases {
  constructor(private readonly http: HttpClient) {}

  create(params: KnowledgeBaseCreateParams): Promise<KnowledgeBaseRow> {
    return this.http.post<KnowledgeBaseRow>('/v1/knowledge-bases', params);
  }

  list(params: KnowledgeBaseListParams = {}): Promise<KnowledgeBaseRow[]> {
    const query = new URLSearchParams();
    if (params.agentId) query.set('agentId', params.agentId);
    const qs = query.toString();
    return this.http.get<KnowledgeBaseRow[]>(`/v1/knowledge-bases${qs ? `?${qs}` : ''}`);
  }

  get(kbId: string): Promise<KnowledgeBaseRow> {
    return this.http.get<KnowledgeBaseRow>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}`);
  }

  delete(kbId: string): Promise<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      `/v1/knowledge-bases/${encodeURIComponent(kbId)}`,
    );
  }

  listDocuments(kbId: string): Promise<KnowledgeBaseDocumentRow[]> {
    return this.http.get<KnowledgeBaseDocumentRow[]>(
      `/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`,
    );
  }

  getDocument(kbId: string, docId: string): Promise<KnowledgeBaseDocumentRow> {
    return this.http.get<KnowledgeBaseDocumentRow>(
      `/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
    );
  }

  createDocument(
    kbId: string,
    params: KnowledgeBaseDocumentCreateParams,
  ): Promise<KnowledgeBaseDocumentCreateResult> {
    return this.http.post<KnowledgeBaseDocumentCreateResult>(
      `/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`,
      params,
    );
  }

  finalizeDocument(kbId: string, docId: string): Promise<KnowledgeBaseDocumentRow> {
    return this.http.post<KnowledgeBaseDocumentRow>(
      `/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}/finalize`,
      {},
    );
  }

  deleteDocument(kbId: string, docId: string): Promise<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      `/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
    );
  }

  /**
   * Convenience wrapper: register a document, upload its bytes to the
   * signed PUT URL the server mints, then call finalize. Returns the
   * document with status flipped to `processing`. Call
   * {@link pollDocumentReady} to wait for ingest completion.
   *
   * The server's signed upload URL expires 600 seconds after issuance,
   * so do not hold the result of {@link createDocument} for long before
   * uploading. This wrapper performs all three steps back-to-back.
   */
  async uploadDocument(
    kbId: string,
    params: KnowledgeBaseDocumentUploadParams,
  ): Promise<KnowledgeBaseDocumentRow> {
    const sizeBytes = byteLengthOf(params.data);

    const { document, upload } = await this.createDocument(kbId, {
      filename: params.filename,
      contentType: params.contentType,
      sizeBytes,
      metadata: params.metadata,
    });

    const putResponse = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: toBodyInit(params.data),
    });

    if (!putResponse.ok) {
      const text = await safeReadText(putResponse);
      throw new SpekoApiError(
        `Document upload failed: ${putResponse.status} ${text || putResponse.statusText}`,
        putResponse.status,
        'DOCUMENT_UPLOAD_FAILED',
      );
    }

    return this.finalizeDocument(kbId, document.id);
  }

  /**
   * Poll a document until it reaches `ready` or `failed` status, or the
   * timeout elapses. Throws {@link SpekoApiError} on `failed` (with the
   * server's `errorMessage`) or on timeout.
   */
  async pollDocumentReady(
    kbId: string,
    docId: string,
    opts: KnowledgeBaseDocumentPollOptions = {},
  ): Promise<KnowledgeBaseDocumentRow> {
    const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const doc = await this.getDocument(kbId, docId);
      if (doc.status === 'ready') return doc;
      if (doc.status === 'failed') {
        throw new SpekoApiError(
          doc.errorMessage ?? 'Document ingest failed',
          500,
          'DOCUMENT_INGEST_FAILED',
        );
      }
      await delay(intervalMs);
    }

    throw new SpekoApiError(
      `Document ingest timed out after ${timeoutMs}ms`,
      408,
      'DOCUMENT_INGEST_TIMEOUT',
    );
  }
}

function byteLengthOf(data: ArrayBuffer | Uint8Array | Blob): number {
  if (data instanceof Blob) return data.size;
  if (data instanceof Uint8Array) return data.byteLength;
  return data.byteLength;
}

function toBodyInit(data: ArrayBuffer | Uint8Array | Blob): Blob | ArrayBuffer {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data;
}

async function safeReadText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
