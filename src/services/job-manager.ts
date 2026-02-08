import { getRedis } from "../redis/client.js";

const JOB_PREFIX = "job:";
const JOB_TTL = 86400; // 24 hours

export interface JobStatus {
  id: string;
  status: "pending" | "crawling" | "processing" | "completed" | "failed";
  totalPages: number;
  processedPages: number;
  failedPages: number;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export async function createJob(jobId: string): Promise<void> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const key = JOB_PREFIX + jobId;

  await redis.hmset(key, {
    id: jobId,
    status: "pending",
    totalPages: "0",
    processedPages: "0",
    failedPages: "0",
    startedAt: now,
    updatedAt: now,
  });
  await redis.expire(key, JOB_TTL);
}

export async function updateJob(
  jobId: string,
  updates: Partial<Pick<JobStatus, "status" | "totalPages" | "processedPages" | "failedPages" | "error">>,
): Promise<void> {
  const redis = getRedis();
  const key = JOB_PREFIX + jobId;

  const fields: Record<string, string> = {
    updatedAt: new Date().toISOString(),
  };

  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) fields[k] = String(v);
  }

  await redis.hmset(key, fields);
  await redis.expire(key, JOB_TTL);
}

export async function getJob(jobId: string): Promise<JobStatus | null> {
  const redis = getRedis();
  const key = JOB_PREFIX + jobId;
  const data = await redis.hgetall(key);

  if (!data || !data.id) return null;

  return {
    id: data.id,
    status: data.status as JobStatus["status"],
    totalPages: parseInt(data.totalPages) || 0,
    processedPages: parseInt(data.processedPages) || 0,
    failedPages: parseInt(data.failedPages) || 0,
    error: data.error || undefined,
    startedAt: data.startedAt,
    updatedAt: data.updatedAt,
  };
}
