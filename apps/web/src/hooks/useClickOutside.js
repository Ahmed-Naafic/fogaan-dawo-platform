import { useEffect } from 'react';

/** While `active`, calls `onClose` on a pointer-down outside `ref` or on Escape. */
export default function useClickOutside(ref, active, onClose) {
  useEffect(() => {
    if (!active) return undefined;
    const onPointer = (e) => !ref.current?.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, active, onClose]);
}
