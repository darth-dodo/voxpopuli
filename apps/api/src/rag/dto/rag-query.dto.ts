import { IsString, IsOptional, IsNumber, IsBoolean, MaxLength, Min, Max } from 'class-validator';

/** Validated DTO for RAG query requests. */
export class RagQueryDto {
  @IsString()
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(7)
  maxSteps?: number;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsBoolean()
  useMultiAgent?: boolean;
}
