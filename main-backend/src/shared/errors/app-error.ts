export interface ErrorDetail {
  field?: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly errors: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errors: ErrorDetail[] = []) {
    super(400, message, 'BAD_REQUEST', errors);
  }
}

export class ValidationError extends AppError {
  constructor(errors: ErrorDetail[], message = 'Validation failed') {
    super(422, message, 'VALIDATION_FAILED', errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, message, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, message, 'CONFLICT');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, message, 'TOO_MANY_REQUESTS');
  }
}
