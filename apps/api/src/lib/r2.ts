import { AwsClient } from "aws4fetch";

const PRESIGN_TTL = 900; // 15 minutes

export const generatePresignedDownloadUrl = async (
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
): Promise<string> => {
  const client = new AwsClient({
    service: "s3",
    region: "auto",
    accessKeyId,
    secretAccessKey,
  });

  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}?X-Amz-Expires=${PRESIGN_TTL}`;

  const signed = await client.sign(new Request(url), {
    aws: { signQuery: true },
  });

  return signed.url.toString();
};
