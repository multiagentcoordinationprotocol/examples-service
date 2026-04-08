import { Request, Response } from 'express';
import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it('should pass through an existing x-correlation-id header', () => {
    const req = { headers: { 'x-correlation-id': 'existing-id' } } as unknown as Request;
    const res = {} as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers['x-correlation-id']).toBe('existing-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should generate a UUID when no correlation id is present', () => {
    const req = { headers: {} } as unknown as Request;
    const res = {} as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    const correlationId = req.headers['x-correlation-id'] as string;
    expect(correlationId).toBeDefined();
    expect(typeof correlationId).toBe('string');
    expect(correlationId.length).toBeGreaterThan(0);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
