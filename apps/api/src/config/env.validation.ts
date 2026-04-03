import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';
import { Type } from 'class-transformer';

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  LLM_PROVIDER = 'groq';

  @IsString()
  @IsOptional()
  GROQ_API_KEY?: string;

  @IsString()
  @IsOptional()
  MISTRAL_API_KEY?: string;

  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string;

  @IsString()
  @IsOptional()
  ELEVENLABS_API_KEY?: string;

  @IsString()
  @IsOptional()
  ELEVENLABS_VOICE_ID?: string;

  @IsString()
  @IsOptional()
  ELEVENLABS_MODEL?: string;

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
