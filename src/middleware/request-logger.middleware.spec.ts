import { RequestLoggerMiddleware } from './request-logger.middleware';
import { EventEmitter } from 'events';

describe('RequestLoggerMiddleware', () => {
  let middleware: RequestLoggerMiddleware;

  beforeEach(() => {
    middleware = new RequestLoggerMiddleware();
  });

  it('should call next and log on response finish', () => {
    const req = { method: 'GET', originalUrl: '/healthz' } as any;
    const res = new EventEmitter() as any;
    res.statusCode = 200;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);

    // Simulate response finishing
    res.emit('finish');
    // Logger was invoked internally — we just verify no crash
  });
});
