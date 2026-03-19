import React, { useEffect, useRef } from 'react';

export interface Props {
  deps: any[];
  change: VoidFunction;
}

export function Listen(props: Props) {
  useEffect(props.change, props.deps);
  return null;
}

export function ListenUpdate(props: Props) {
  const ref = useRef(true);
  useEffect(() => {
    if (ref.current) ref.current = false;
    else props.change();
  }, props.deps);
  return null;
}
