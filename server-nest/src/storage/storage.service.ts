import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Thin wrapper around Supabase Storage. Replaces the old Multer-to-local-disk
 * upload path in the legacy index.js (which stored files under
 * server/uploads and served them via `/uploads`, a pattern that doesn't
 * survive a Railway redeploy or scale past one instance).
 *
 * Node 20 compatibility / realtime notes:
 * - This backend only uses Storage, never Realtime or client-side Auth, so
 *   the client is created with `auth.persistSession`/`autoRefreshToken`
 *   disabled (there's no browser session to persist server-side — leaving
 *   these on wastes a background refresh timer) and Realtime's heartbeat
 *   effectively neutered (`eventsPerSecond: 0`). We never call
 *   `.channel()`/`.subscribe()` anywhere, so no WebSocket connection is
 *   ever opened regardless — this just makes that explicit instead of
 *   relying on "we never call it."
 * - Node 20 has global `fetch`, so no fetch polyfill is needed for the
 *   supabase-js v2 client.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: SupabaseClient;
  private bucket: string;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      // Fail fast with a clear message instead of letting the Supabase SDK
      // throw its generic "supabaseUrl is required" error, which gives no
      // indication of which env var is actually missing.
      throw new Error(
        'StorageService: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. ' +
          `Missing: ${[!url && 'SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(', ')}`,
      );
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 0 },
      },
    });
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'citrine-media';
    this.logger.log(`Supabase Storage client initialized (bucket: ${this.bucket})`);
  }

  async upload(path: string, buffer: Buffer, contentType: string): Promise<string> {
    const { error } = await this.client.storage.from(this.bucket).upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (error) throw error;
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async remove(path: string): Promise<void> {
    await this.client.storage.from(this.bucket).remove([path]);
  }

  /** Signed URL for private objects (e.g. invoice PDFs), expires in `expiresInSeconds`. */
  async getSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  }
}
