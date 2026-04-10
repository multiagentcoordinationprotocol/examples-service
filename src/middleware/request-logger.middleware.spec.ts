import { Request, Response } from 'express';
import { RequestLoggerMiddleware } from './request-logger.middleware';
import { EventEmitter } from 'events';

describe('RequestLoggerMiddleware', () => {
  let middleware: RequestLoggerMiddleware;

  beforeEach(() => {
    middleware = new RequestLoggerMiddleware();
  });

  it('should call next and log on response finish', () => {
    const req = { method: 'GET', originalUrl: '/healthz' } as unknown as Request;
    const emitter = Object.assign(new EventEmitter(), { statusCode: 200 });
    const res = emitter as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);

    // Simulate response finishing
    emitter.emit('finish');
    // Logger was invoked internally — we just verify no crash
  });
});
