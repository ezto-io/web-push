// Validation functions
const validateFingerCount = (fingerCount) => {
  const errors = [];
  
  if (typeof fingerCount !== 'object') {
    errors.push('fingerCount must be an object');
    return errors;
  }

  if (typeof fingerCount.enabled !== 'boolean') {
    errors.push('fingerCount.enabled must be a boolean');
  }

  if (fingerCount.enabled && fingerCount.expected !== undefined) {
    if (typeof fingerCount.expected !== 'number') {
      errors.push('fingerCount.expected must be a number');
    } else if (!Number.isInteger(fingerCount.expected)) {
      errors.push('fingerCount.expected must be an integer');
    } else if (fingerCount.expected < 1 || fingerCount.expected > 5) {
      errors.push('fingerCount.expected must be between 1 and 5');
    }
  }

  return errors;
};

const validateBlink = (blink) => {
  const errors = [];
  
  if (typeof blink !== 'object') {
    errors.push('blink must be an object');
    return errors;
  }

  if (typeof blink.enabled !== 'boolean') {
    errors.push('blink.enabled must be a boolean');
  }

  if (blink.enabled && blink.expected !== undefined) {
    if (typeof blink.expected !== 'number') {
      errors.push('blink.expected must be a number');
    } else if (!Number.isInteger(blink.expected)) {
      errors.push('blink.expected must be an integer');
    } else if (blink.expected < 1 || blink.expected > 10) {
      errors.push('blink.expected must be between 1 and 10');
    }
  }

  return errors;
};

const validateSpeech = (speech) => {
  const errors = [];
  
  if (typeof speech !== 'object') {
    errors.push('speech must be an object');
    return errors;
  }

  if (typeof speech.enabled !== 'boolean') {
    errors.push('speech.enabled must be a boolean');
  }

  if (speech.enabled && speech.expected !== undefined) {
    if (typeof speech.expected !== 'string') {
      errors.push('speech.expected must be a string');
    } else if (speech.expected.trim().length === 0) {
      errors.push('speech.expected cannot be empty');
    } else if (speech.expected.length > 20) {
      errors.push('speech.expected must be 20 characters or less');
    } else if (!/^[a-zA-Z\s]+$/.test(speech.expected)) {
      errors.push('speech.expected must contain only letters and spaces');
    }
  }

  return errors;
};

const validateMovement = (movement) => {
  const errors = [];
  
  if (typeof movement !== 'object') {
    errors.push('movement must be an object');
    return errors;
  }

  if (typeof movement.enabled !== 'boolean') {
    errors.push('movement.enabled must be a boolean');
  }

  return errors;
};

// Main validation function
const validateConfig = (config) => {
  const errors = [];
  
  if (!config || typeof config !== 'object') {
    throw new Error('Configuration must be an object');
  }

  // Validate each section if present
  if (config.fingerCount) {
    errors.push(...validateFingerCount(config.fingerCount));
  }

  if (config.blink) {
    errors.push(...validateBlink(config.blink));
  }

  if (config.speech) {
    errors.push(...validateSpeech(config.speech));
  }

  if (config.movement) {
    errors.push(...validateMovement(config.movement));
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
  }

  return true;
};

// Helper function to sanitize and apply defaults
const sanitizeConfig = (userConfig, defaultConfig) => {
  validateConfig(userConfig);
  
  return {
    fingerCount: {
      ...defaultConfig.fingerCount,
      ...userConfig.fingerCount
    },
    blink: {
      ...defaultConfig.blink,
      ...userConfig.blink
    },
    speech: {
      ...defaultConfig.speech,
      ...userConfig.speech
    },
    movement: {
      ...defaultConfig.movement,
      ...userConfig.movement
    }
  };
};

// Export all functions
export {
  validateConfig,
  validateFingerCount,
  validateBlink,
  validateSpeech,
  validateMovement,
  sanitizeConfig
};