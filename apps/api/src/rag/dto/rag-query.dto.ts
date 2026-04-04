import { IsString, IsOptional, IsNumber, MaxLength, Min, Max } from 'class-validator';

/** Validated DTO for RAG query requests. */
export class RagQueryDto {
  @IsString()
  @MaxLength(500)
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(7)
  maxSteps?: number;

  @IsOptional()
  @IsString()
  provider?: string;
}
