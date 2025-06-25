import React from 'react';
import { useTheme } from '../hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
  size?: 'small' | 'medium' | 'large';
}

/**
 * 🎨 Theme Toggle Component
 * 
 * Displays current system theme. Theme automatically follows system preferences.
 * This is now a display-only component since theme switching is system-driven.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  className = '', 
  showLabel = true,
  size = 'medium'
}) => {
  const { resolvedMode } = useTheme();

  const getThemeIcon = () => {
    return resolvedMode === 'light' ? '☀️' : '🌙';
  };

  const getThemeLabel = () => {
    return `${resolvedMode === 'light' ? 'Light' : 'Dark'} (System)`;
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small': return 'theme-toggle--small';
      case 'large': return 'theme-toggle--large';
      default: return 'theme-toggle--medium';
    }
  };

  return (
    <div
      className={`theme-toggle ${getSizeClasses()} ${className}`}
      title={`Current theme: ${getThemeLabel()}`}
    >
      <span className="theme-toggle__icon" role="img" aria-hidden="true">
        {getThemeIcon()}
      </span>
      {showLabel && (
        <span className="theme-toggle__label">
          {getThemeLabel()}
        </span>
      )}
    </div>
  );
};

/**
 * 🎨 Quick Theme Toggle (icon only)
 * 
 * Display-only version showing current system theme.
 */
export const QuickThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { resolvedMode } = useTheme();

  return (
    <div
      className={`theme-toggle theme-toggle--quick ${className}`}
      title={`Current theme: ${resolvedMode} (follows system)`}
    >
      <span className="theme-toggle__icon" role="img" aria-hidden="true">
        {resolvedMode === 'light' ? '☀️' : '🌙'}
      </span>
    </div>
  );
}; 