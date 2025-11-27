import React from 'react';
import { Minus, Copy, Maximize2, X, Film } from 'lucide-react';

interface TitleBarProps {
  isMaximized: boolean;
}

export const TitleBar: React.FC<TitleBarProps> = ({ isMaximized }) => {
  const handleMinimize = () => window.electron?.windowMinimize();
  const handleMaximize = () => window.electron?.windowMaximize();
  const handleClose = () => window.electron?.windowClose();

  return (
    <div 
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="fixed top-0 left-0 right-0 h-8 bg-black/20 backdrop-blur-md flex items-center justify-between z-[9998] border-b border-white/10"
    >
      <div className="flex items-center gap-2 px-3">
        <Film size={14} className="text-blue-400" />
        <span className="text-xs font-bold text-gray-300">SheiyuWatch</span>
      </div>

      <div 
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center h-full"
      >
        <button onClick={handleMinimize} className="h-full px-4 text-gray-400 hover:bg-white/10 hover:text-white transition-colors focus:outline-none">
          <Minus size={16} />
        </button>
        <button onClick={handleMaximize} className="h-full px-4 text-gray-400 hover:bg-white/10 hover:text-white transition-colors focus:outline-none">
          {isMaximized ? <Copy size={14} /> : <Maximize2 size={14} />}
        </button>
        <button onClick={handleClose} className="h-full px-4 text-gray-400 hover:bg-red-500 hover:text-white transition-colors focus:outline-none">
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
