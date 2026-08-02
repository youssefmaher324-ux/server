import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

/**
 * Thin wrapper around Supabase Storage. Replaces the old Multer-to-local-disk
 * upload path in the legacy index.js (which stored files under
 * server/uploads and served them via `/uploads`, a pattern that doesn't
 * survive a Railway redeploy or scale past one instance).
 *
 * Node 20 / realtime notes:
 * - This backend only uses Storage — it never calls `.channel()` or
 *   `.subscribe()` — but `@supabase/supabase-js` unconditionally constructs
 *   an internal RealtimeClient the moment `createClient()` runs, regardless
 *   of whether you ever use it. That RealtimeClient needs a WebSocket
 *   implementation, and Node 20 does not have a stable global `WebSocket`
 *   (it landed as experimental only in Node 21+, so `globalThis.WebSocket`
 *   is undefined on Node 20). Left unconfigured, `@supabase/realtime-js`
 *   tries to auto-detect one and throws — this is exactly the crash.
 *   Passing the `ws` package explicitly as `realtime.transport` sidesteps
 *   the auto-detection entirely, so it never matters that Node 20 has no
 *   native WebSocket.
 * - `auth.persistSession`/`autoRefreshToken`/`detectSessionInUrl` are all
 *   disabled — there's no browser session to persist server-side, and the
 *   service-role key never expires the way a user JWT would.
 * - Node 20 has global `fetch`, so no fetch polyfill is needed for the
 *   supabase-js v2 client itself.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: SupabaseClient | undefined;
  private bucket: string;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      // Previously threw here — but throwing inside a constructor kills
      // the whole Nest bootstrap the same way an eager Prisma $connect()
      // failure does (see prisma.service.ts): the process exits before
      // app.listen() ever runs, so even the DB/Supabase-independent
      // /api/health liveness check never gets a chance to respond, and
      // Railway fails the entire deploy over one missing optional feature.
      // Log loudly instead and fail only when banners/invoices actually
      // try to use storage.
      this.logger.error(
        'StorageService: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set for banner/invoice uploads to work. ' +
          `Missing: ${[!url && 'SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(', ')}. ` +
          'The app will still start; storage-dependent routes will fail until this is fixed.',
      );
      this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'monastery-media';
      return;
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        // Explicit transport = no runtime WebSocket auto-detection = no
        // Node-20-has-no-global-WebSocket crash. eventsPerSecond: 0 means
        // even if something did open a channel, it'd be inert.
        transport: WebSocket as unknown as typeof globalThis.WebSocket,
        params: { eventsPerSecond: 0 },
      },
    });
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'monastery-media';
    this.logger.log(`Supabase Storage client initialized (bucket: ${this.bucket})`);
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error(
        'Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing) — this route needs those set to work.',
      );
    }
    return this.client;
  }

  async upload(path: string, buffer: Buffer, contentType: string): Promise<string> {
    const client = this.getClient();
    const { error } = await client.storage.from(this.bucket).upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (error) throw error;
    const { data } = client.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async remove(path: string): Promise<void> {
    await this.getClient().storage.from(this.bucket).remove([path]);
  }

  /** Signed URL for private objects (e.g. invoice PDFs), expires in `expiresInSeconds`. */
  async getSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.getClient().storage.from(this.bucket).createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  }
}
