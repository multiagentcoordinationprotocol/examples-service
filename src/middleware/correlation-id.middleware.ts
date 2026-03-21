import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    next();
  }
}
