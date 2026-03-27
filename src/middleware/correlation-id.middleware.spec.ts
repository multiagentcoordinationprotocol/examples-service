import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it('should pass through an existing x-correlation-id header', () => {
    const req = { headers: { 'x-correlation-id': 'existing-id' } } as any;
    const res = {} as any;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers['x-correlation-id']).toBe('existing-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should generate a UUID when no correlation id is present', () => {
    const req = { headers: {} } as any;
    const res = {} as any;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers['x-correlation-id']).toBeDefined();
    expect(typeof req.headers['x-correlation-id']).toBe('string');
    expect(req.headers['x-correlation-id'].length).toBeGreaterThan(0);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
