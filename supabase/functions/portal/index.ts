import { createHandler } from './handler.mjs';

Deno.serve(createHandler({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  pepper: Deno.env.get('SESSION_TOKEN_PEPPER') ?? '',
  allowedOrigins: Deno.env.get('ALLOWED_ORIGINS') ?? '',
  googleServiceAccountJson: Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '',
  googlePendingFolderId: Deno.env.get('GOOGLE_DRIVE_PENDING_FOLDER_ID') ?? '',
  googleApprovedFolderId: Deno.env.get('GOOGLE_DRIVE_APPROVED_FOLDER_ID') ?? '',
  googleRejectedFolderId: Deno.env.get('GOOGLE_DRIVE_REJECTED_FOLDER_ID') ?? '',
}));
