export interface PublishInput {
  postId: number;
  subAccountId: number;
  connectionId: number | null;
  platform: string;
  title: string | null;
  body: string | null;
  mediaIds: number[] | null;
  credentials: PlatformCredentials | null;
}

export interface PlatformCredentials {
  accessToken: string;
  pageId?: string;
  igUserId?: string;
  appSecret?: string;
}

export interface PublishResult {
  success: boolean;
  platform: string;
  externalPostId: string | null;
  errorMessage: string | null;
}

export interface PlatformAdapter {
  platform: string;
  validate(input: PublishInput): { valid: boolean; error?: string };
  publish(input: PublishInput): Promise<PublishResult>;
}
