import React, { useState, useCallback, useRef } from 'react';

interface ResizableDividerProps {
  onResize: (width: number) => void;
  minWidth: number;
  maxWidth: number;
  currentWidth: number;
  className?: string;
}

const ResizableDivider: React.FC<ResizableDividerProps> = ({
  onResize,
  minWidth,
  maxWidth,
  currentWidth,
  className = ''
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    
    // Use the current width passed from parent component
    startWidthRef.current = currentWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [currentWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const deltaX = e.clientX - startXRef.current;
    const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + deltaX));
    
    onResize(newWidth);
  }, [isDragging, onResize, minWidth, maxWidth]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [isDragging]);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      className={`resizable-divider ${className} ${isDragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <div className="divider-handle" />
    </div>
  );
};

export default ResizableDivider;