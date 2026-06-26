import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/index.js';

describe('createLogger', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('emits JSON entries with level, service and msg', () => {
    const log = createLogger({ level: 'info', service: 'test-service' });
    log.info('hello', { foo: 'bar' });
    expect(warnSpy).toHaveBeenCalledOnce();
    const entry = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
    expect(entry.level).toBe('info');
    expect(entry.service).toBe('test-service');
    expect(entry.msg).toBe('hello');
    expect(entry.foo).toBe('bar');
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('routes error level to console.error', () => {
    const log = createLogger({ level: 'info', service: 's' });
    log.error('boom');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('respects level threshold', () => {
    const log = createLogger({ level: 'warn', service: 's' });
    log.debug('debug');
    log.info('info');
    expect(warnSpy).not.toHaveBeenCalled();
    log.warn('warn');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('child logger merges bindings', () => {
    const log = createLogger({ level: 'info', service: 's', bindings: { a: 1 } });
    const child = log.child({ b: 2 });
    child.info('msg');
    const entry = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
    expect(entry.a).toBe(1);
    expect(entry.b).toBe(2);
  });
});
