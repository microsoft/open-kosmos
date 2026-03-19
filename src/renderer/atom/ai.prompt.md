Atom is an elegant state management solution
* Only depends on React itself
* Minimal code, yet fully featured
* Robust type system
* Core API consists of just 3 functions: `atom` (define state), `WithStore` (root component Provider), and `mutate` (define a set of operations)

`<WithStore>...</WithStore>` only needs to wrap the outermost layer of the application, so it won't be elaborated here

## Basic Introduction
First, understand two type definitions
```ts
type Reduce<T> = (data: T) => T;
type Change<T> = (ch: Reduce<T> | T) => void;
```
The set function mentioned throughout this document has the type `Change<T>`, and its behavior is consistent with React.useState's setter

Three types of atoms can be created using the `atom` function

### 1. Value Atom
Basic usage is as follows, where `set` in the code has the type `Change<T>`
```tsx
const priceAtom = atom(100);
function Component1() {
  const [price, set] = priceAtom.useData();
  return <div>{price}</div>;
}
function Component2() {
  // When using useChange, changes to priceAtom's value will not cause Component2 to re-render
  const set = priceAtom.useChange();
  return <button onClick={() => set(150)}>increase</button>;
}
```

### 2. Action Atom
Builds on Value Atom by adding the ability to define a set of predefined operations
```tsx
// Here `get` always retrieves the latest value, and `set` has the type `Change<T>`
const priceAtom = atom(100, (get, set) => {
  return {
    increase: (delta: number) => set(get() + delta),
    decrease: (delta: number) => set((prev) => prev - delta),
  };
});
function Component1() {
  const [price, actions] = priceAtom.useData();
  return <div>{price}</div>;
}
function Component2() {
  // When using useChange, changes to priceAtom's value will not cause Component2 to re-render
  const actions = priceAtom.useChange();
  return <button onClick={() => actions.increase(1)}>increase</button>;
}
```
With Action Atom, you can encapsulate complex operations into functions as needed, making them easy to reuse across different components.
The functions to be encapsulated can be synchronous or asynchronous — for example, you can fetch data from a server and update the atom's value based on the result, which gives us the opportunity to extract common business operations into shared logic

### 3. Computed Atom
This is a read-only atom whose value is derived from other atoms
```tsx
const priceAtom = atom(100);
const taxAtom = atom(0.1);
const totalAtom = atom((use) => use(priceAtom) * (1 + use(taxAtom)));
function Component() {
  // Computed atoms can only use useData to get the value — there is no useChange method, and the data cannot be modified
  const total = totalAtom.useData();
  return <div>{total}</div>;
}
```
When creating an atom, the `use` method can accept any other type of atom (including value atom, action atom, computed atom) and return its value. It also automatically subscribes to their changes, so that when a dependent atom changes, it recalculates its own value.


## Advanced Usage

### 1. Action Atoms Can Also Read and Modify Other Atoms
```ts
const a = atom(1);
const b = atom(2);
const c = atom(3, (get, set, use) => {
  function add(delta: number) {
    const [a_val, setA] = use(a);
    const [b_val, setB] = use(b);
    set(a_val + b_val + delta * 2);
    setA(a_val + delta);
    setB(b_val + delta);
  }
  return { add };
});
```

As you can see, when creating an action atom, you also get a `use` method that can accept any other type of atom. This method is flexible:
* When passing a value atom: returns a `[value, set]` tuple
* When passing an action atom: returns a `[value, actions]` tuple
* When passing a computed atom: returns only its value

This `use` works similarly to React hooks, so it's easy to understand. However, note that `use` always retrieves the latest value of other atoms each time it's called, but it does not establish a subscription — changes in other atoms will not trigger the action function to re-execute


### 2. Async Initialization
Sometimes we want an atom's initial value to come from a server, but this async process is not suitable for execution within a component. Here's an elegant solution:
```ts
type Product = { /* ... */ };
const productsAtom = atom([] as Product[], (get, set) => {
  async function initialize() {
    set(await fetchProductsFromServer());
  }
  initialize();

  function deleteProduct(id: string) {
    set(get().filter(product => product.id !== id));
  }
  return { deleteProduct };
});
```

The `initialize` function does not execute immediately — it only runs the first time this productsAtom is used, and it only runs once. Note that "used" here includes 3 scenarios:
* Being depended on by another computed atom via use
* Being depended on by another action atom via use
* Calling productsAtom.useXXX in a component

By extension, this async initialization strategy also applies to other scenarios

### 3. Using with immer (or mutative, etc.)
When an atom's value is a complex object, directly modifying it can be cumbersome. Here's an example using immer to simplify the operation:

```tsx
import { produce } from 'immer';
type Product = { /* ... */ };
const productsAtom = atom([] as Product[]);
function Component() {
  const setProducts = productsAtom.useChange();
  function add(item: Product) {
    setProducts(produce((draft) => {
      draft.push(item);
    }));
  }
  return (/* ... */);
}
```

```ts
import { produce } from 'immer';
type Product = { /* ... */ };
const productsAtom = atom([] as Product[], (get, set) => {
  function add(item: Product) {
    set(produce((draft) => {
      draft.push(item);
    }));
  }
  return { add };
});
```

### 4. Using mutate to Define a Set of Operations
When we need to perform joint operations on multiple atoms, we can use mutate to define reusable functions
```ts
const price1Atom = atom(100);
const price2Atom = atom(200);

const discountMutation = mutate((use) => (percent: number) => {
    const [price1, setPrice1] = use(price1Atom);
    const [price2, setPrice2] = use(price2Atom);
    setPrice1(price1 * percent);
    setPrice2(price2 * percent);
  },
});

function Component() {
  const discount = discountMutation.use();
  return <button onClick={() => discount(0.1)}>Discount</button>;
}
```