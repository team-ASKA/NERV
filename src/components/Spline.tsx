import React, { useState, useEffect } from 'react';
import Spline from '@splinetool/react-spline';

export default function SplineComponent() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // Set a timeout to handle loading issues
    const timeout = setTimeout(() => {
      if (isLoading) {
        setHasError(true);
        setIsLoading(false);
      }
    }, 10000); // 10 second timeout

    return () => clearTimeout(timeout);
  }, [isLoading]);

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };

  if (hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-900/20 to-purple-900/20 rounded-lg">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
            <span className="text-2xl">🧠</span>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">AI-Powered Interview Platform</h3>
          <p className="text-gray-400 text-sm">Advanced emotion analysis and interview simulation</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-900/20 to-purple-900/20 rounded-lg">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-white text-sm">Loading 3D Experience...</p>
          </div>
        </div>
      )}
      <Spline 
        scene="https://prod.spline.design/2uDZKvh6fpchgFIb/scene.splinecode"
        onLoad={handleLoad}
        onError={handleError}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

