import { Controller, Get, Query, Param, ParseIntPipe } from '@nestjs/common';
import { HnService } from './hn.service';

/**
 * Temporary test controller for verifying HN data layer.
 * Remove before M3 (RagController replaces this).
 */
@Controller('hn')
export class HnController {
  constructor(private readonly hnService: HnService) {}

  /** Search HN stories. Try: /api/hn/search?q=rust+vs+go */
  @Get('search')
  search(
    @Query('q') query: string,
    @Query('sort') sort?: 'relevance' | 'date',
    @Query('min_points') minPoints?: string,
    @Query('limit') hitsPerPage?: string,
  ) {
    const options = {
      minPoints: minPoints ? parseInt(minPoints, 10) : undefined,
      hitsPerPage: hitsPerPage ? parseInt(hitsPerPage, 10) : 5,
    };
    if (sort === 'date') {
      return this.hnService.searchByDate(query || 'hello', options);
    }
    return this.hnService.search(query || 'hello', options);
  }

  /** Get a single story. Try: /api/hn/item/1 */
  @Get('item/:id')
  getItem(@Param('id', ParseIntPipe) id: number) {
    return this.hnService.getItem(id);
  }

  /** Get comments for a story. Try: /api/hn/comments/38543832 */
  @Get('comments/:storyId')
  getComments(@Param('storyId', ParseIntPipe) storyId: number) {
    return this.hnService.getCommentTree(storyId);
  }
}
