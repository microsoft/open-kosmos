import { LeftNavSizeAtom } from '@renderer/states/left-nav.atom';
interface ResizableDividerProps {
  className?: string;
}

const ResizableDivider: React.FC<ResizableDividerProps> = ({ className = '' }) => {
  const [{ resizing }, { startResize }] = LeftNavSizeAtom.use();
  return (
    <div
      className={`resizable-divider ${className} ${resizing ? 'dragging' : ''}`}
      onMouseDown={startResize}
    >
      <div className="divider-handle" />
    </div>
  );
};

export default ResizableDivider;