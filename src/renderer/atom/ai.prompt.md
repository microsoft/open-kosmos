Atom is a lightweight state management solution that:
* Depends only on React itself
* Has minimal code yet is fully featured
* Has a sufficiently robust type system
* Exposes only 3 core APIs: `atom` (define state), `WithStore` (root component Provider), and `mutate` (define a set of operations)

`<WithStore>...</WithStore>` just needs to wrap the outermost layer of the application; no further explanation is needed here.

## Introduction
First, understand two type definitions:
```ts
type Reduce<T> = (data: T) => T;
type Change<T> = (ch: Reduce<T> | T) => void;
```
The `set` function mentioned throughout has the type `Change<T>`, and behaves identically to the setter from React's `useState`.

Using the `atom` function, you can create 3 types of atoms:

### 1. Value Atom
Basic usage is shown below. The `set` in the code has type `Change<T>`:
```tsx
const priceAtom = atom(100);
function Component1() {
  const [price, set] = priceAtom.use();
  return <div>{price}</div>;
}
function Component2() {
  // When using useChange, changes to priceAtom will NOT cause Component2 to re-render
  const set = priceAtom.useChange();
  return <button onClick={() => set(150)}>increase</button>;
}
```

### 2. Action Atom
Builds on Value Atom by adding the ability to define a set of pre-defined operations:
```tsx
// Here `get` always returns the latest value; `set` has type `Change<T>`
const priceAtom = atom(100, (get, set) => {
  return {
    increase: (delta: number) => set(get() + delta),
    decrease: (delta: number) => set((prev) => prev - delta),
  };
});
function Component1() {
  const [price, actions] = priceAtom.use();
  return <div>{price}</div>;
}
function Component2() {
  // When using useChange, changes to priceAtom will NOT cause Component2 to re-render
  const actions = priceAtom.useChange();
  return <button onClick={() => actions.increase(1)}>increase</button>;
}
```
With Action Atom, you can encapsulate complex operations into functions on demand, making them easy to reuse across different components.
The functions you encapsulate can be synchronous or asynchronous — for example, you can fetch data from a server and update the atom's value based on the result. This gives us the opportunity to extract common business operations into shared logic.

### 3. Computed Atom
A read-only atom whose value is derived by computing from other atoms:
```tsx
const priceAtom = atom(100);
const taxAtom = atom(0.1);
const totalAtom = atom((use) => use(priceAtom) * (1 + use(taxAtom)));
function Component() {
  // Computed atoms can only use `use` to retrieve their value; there is no useChange method and the data cannot be mutated
  const total = totalAtom.use();
  return <div>{total}</div>;
}
```
When creating an atom, the `use` method can accept any other atom type (including value atom, action atom, and computed atom) and returns its value. It also automatically subscribes to their changes, recomputing its own value whenever a dependency atom changes.


## Advanced Usage

### 1. Action Atoms can also read and modify other atoms
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

You can see that when creating an action atom, you also receive a `use` method. This method also accepts any atom type, but behaves flexibly:
* When passed a value atom: returns a `[value, set]` tuple
* When passed an action atom: returns a `[value, actions]` tuple
* When passed a computed atom: returns only its value

This `use` works much like React hooks, which makes it intuitive. Note, however: each `use` call fetches the latest value from the other atom but does NOT establish a subscription — changes to other atoms will not trigger the action function to re-execute.


### 2. Async Initialization
Sometimes we want an atom's initial value to come from a server, but running that async process inside a component is not ideal. Here is an elegant way to handle it:
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

The `initialize` function is not executed immediately — it is only called the first time this `productsAtom` is `use`d, and only once. Note that "use" here covers 3 cases:
* Being `use`d by another computed atom
* Being `use`d by another action atom
* A component calling `productsAtom.useXXX`

By extension, this async initialization strategy works in other scenarios as well.

### 3. Using with immer (or mutative, etc.)
When an atom's value is a complex object, mutating it directly can be cumbersome. Here is an example using immer to simplify things:

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

### 4. Using mutate to define a set of operations
When you need to perform combined operations on multiple atoms, use `mutate` to define reusable functions:
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
