import React from 'react';
import { useTheme, type ThemeMode } from '../hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
  size?: 'small' | 'medium' | 'large';
}

/**
 * 🎨 Theme Toggle Component
 * 
 * Provides a button interface for switching between light, dark, and auto theme modes.
 * Integrates with the configuration system and useTheme hook.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  className = '', 
  showLabel = true,
  size = 'medium'
}) => {
  const { currentMode, resolvedMode, setThemeMode, toggleTheme, isAuto } = useTheme();

  const getThemeIcon = () => {
    if (isAuto) {
      return '🔄'; // Auto mode
    }
    return resolvedMode === 'light' ? '☀️' : '🌙';
  };

  const getThemeLabel = () => {
    if (isAuto) {
      return `Auto (${resolvedMode})`;
    }
    return resolvedMode === 'light' ? 'Light' : 'Dark';
  };

  const getNextMode = (): ThemeMode => {
    switch (currentMode) {
      case 'light': return 'dark';
      case 'dark': return 'auto';
      case 'auto': return 'light';
      default: return 'light';
    }
  };

  const handleClick = () => {
    const nextMode = getNextMode();
    setThemeMode(nextMode);
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small': return 'theme-toggle--small';
      case 'large': return 'theme-toggle--large';
      default: return 'theme-toggle--medium';
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`theme-toggle ${getSizeClasses()} ${className}`}
      title={`Switch theme (currently ${getThemeLabel()})`}
      aria-label={`Switch theme. Current: ${getThemeLabel()}`}
    >
      <span className="theme-toggle__icon" role="img" aria-hidden="true">
        {getThemeIcon()}
      </span>
      {showLabel && (
        <span className="theme-toggle__label">
          {getThemeLabel()}
        </span>
      )}
    </button>
  );
};

/**
 * 🎨 Quick Theme Toggle (icon only)
 * 
 * A simplified version that just toggles between light and dark (no auto mode).
 */
export const QuickThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { resolvedMode, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`theme-toggle theme-toggle--quick ${className}`}
      title={`Switch to ${resolvedMode === 'light' ? 'dark' : 'light'} theme`}
      aria-label={`Switch to ${resolvedMode === 'light' ? 'dark' : 'light'} theme`}
    >
      <span className="theme-toggle__icon" role="img" aria-hidden="true">
        {resolvedMode === 'light' ? '🌙' : '☀️'}
      </span>
    </button>
  );
}; 