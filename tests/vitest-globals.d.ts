import type { Mock as VMock, MockInstance as VMockInstance, Mocked as VMocked, MockedFunction as VMockedFunction, MockedClass as VMockedClass } from 'vitest';

declare global {
  type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> = VMock<T>;
  type MockInstance<T extends (...args: any[]) => any = (...args: any[]) => any> = VMockInstance<T>;
  type Mocked<T> = VMocked<T>;
  type MockedFunction<T extends (...args: any[]) => any> = VMockedFunction<T>;
  type MockedClass<T extends new (...args: any[]) => any> = VMockedClass<T>;
}

export {};
