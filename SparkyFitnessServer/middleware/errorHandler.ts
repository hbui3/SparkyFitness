import type { NextFunction, Request, Response } from 'express';
import { log } from '../config/logging.js';
import { describeError, isInternalError } from '../utils/errors.js';

interface ErrorFields {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  type?: unknown;
  stack?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const error: ErrorFields =
    typeof err === 'object' && err !== null ? (err as ErrorFields) : {};
  // The query string can carry credentials, such as a password reset token.
  const path = req.originalUrl.split('?')[0];
  log(
    'error',
    `Error caught by centralized handler on ${req.method} ${path}: ${describeError(err)}`,
    error.stack
  );
  const explicitStatus = [error.status, error.statusCode].find(
    (status): status is number => typeof status === 'number'
  );
  // Default to 500 Internal Server Error
  let statusCode = explicitStatus ?? 500;
  let message =
    (typeof error.message === 'string' && error.message) ||
    'Internal Server Error';
  let code = typeof error.code === 'string' ? error.code : undefined;

  if (
    error.name === 'PayloadTooLargeError' ||
    error.type === 'entity.too.large' ||
    statusCode === 413
  ) {
    statusCode = 413;
    code = 'IMAGE_TOO_LARGE';
    message = 'Request payload too large. Please reduce the image size.';
  } else {
    // Handle specific error types if needed (e.g., database errors, validation errors)
    switch (error.name) {
      case 'UnauthorizedError':
        statusCode = 401;
        message = 'Unauthorized: Invalid or missing token.';
        break;
      case 'ForbiddenError':
        statusCode = 403;
        message =
          'Forbidden: You do not have permission to perform this action.';
        break;
      case 'ValidationError':
        statusCode = 400;
        break;
      default:
        if (error.code === '23505') {
          statusCode = 409;
          message =
            'Conflict: A resource with this unique identifier already exists.';
        } else if (
          statusCode >= 500 &&
          process.env.NODE_ENV !== 'development' &&
          isInternalError(err)
        ) {
          // The full error is in the log line above.
          message = 'Internal Server Error';
          code = undefined;
        }
        break;
    }
  }
  res.status(statusCode).json({
    error: message,
    code,
    details: process.env.NODE_ENV === 'development' ? error.stack : undefined, // Only send stack in development
  });
};
export default errorHandler;
