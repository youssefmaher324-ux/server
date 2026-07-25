import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Thin wrapper around Supabase Storage. Replaces the old Multer-to-local-disk
 * upload path in the legacy index.js (which stored files under
 * server/uploads and served them via `/uploads`, a pattern that doesn't
 * survive a Railway redeploy or scale past one instance).
 */
@Injectable()
export class StorageService {
  private client: SupabaseClient;
  private bucket: string;

  constructor() {
    this.client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'citrine-media';
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
