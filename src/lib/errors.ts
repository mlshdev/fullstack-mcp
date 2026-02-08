export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, "AUTH_ERROR", 401);
    this.name = "AuthError";
  }
}

export class RateLimitError extends AppError {
  constructor(
    public readonly retryAfter: number,
  ) {
    super("Rate limit exceeded", "RATE_LIMIT", 429);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Not found") {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class CrawlError extends AppError {
  constructor(message: string) {
    super(message, "CRAWL_ERROR", 500);
    this.name = "CrawlError";
  }
}
