import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './exception.filter';
import { AppException } from './app-exception';
import { ErrorCode } from './error-codes';

function createMockHost(mockJson: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({
        status: jest.fn().mockReturnValue({ json: mockJson })
      })
    })
  } as unknown as ArgumentsHost;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockJson: jest.Mock;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockJson = jest.fn();
  });

  it('should handle AppException and return structured response', () => {
    const exception = new AppException(ErrorCode.VALIDATION_ERROR, 'bad input', HttpStatus.BAD_REQUEST, {
      field: 'amount'
    });
    const host = createMockHost(mockJson);

    filter.catch(exception, host);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        message: 'bad input'
      })
    );
  });

  it('should handle generic HttpException', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    const host = createMockHost(mockJson);

    filter.catch(exception, host);

    expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('should handle HttpException with string response', () => {
    const exception = new HttpException('forbidden', HttpStatus.FORBIDDEN);
    const host = createMockHost(mockJson);

    filter.catch(exception, host);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        errorCode: 'INTERNAL_ERROR',
        message: 'forbidden'
      })
    );
  });

  it('should handle unknown errors as 500', () => {
    const host = createMockHost(mockJson);

    filter.catch(new Error('unexpected'), host);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        errorCode: 'INTERNAL_ERROR',
        message: 'Internal server error'
      })
    );
  });

  it('should handle non-Error throwables', () => {
    const host = createMockHost(mockJson);

    filter.catch('string error', host);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        errorCode: 'INTERNAL_ERROR'
      })
    );
  });
});
