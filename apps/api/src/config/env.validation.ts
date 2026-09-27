import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';
import { Type } from 'class-transformer';

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  LLM_PROVIDER = 'mistral';

  @IsString()
  @IsOptional()
  OPENROUTER_API_KEY?: string;

  @IsString()
  @IsOptional()
  OPENROUTER_MODEL?: string;

  @IsString()
  @IsOptional()
  MISTRAL_API_KEY?: string;

  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string;

  @IsString()
  @IsOptional()
  MISTRAL_TTS_MODEL?: string;

  @IsString()
  @IsOptional()
  MISTRAL_TTS_VOICE?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  PORT = 3000;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
