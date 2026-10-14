// GET-only endpoints transcribed from https://rmp.richis.top/openapi.json (2026-10-14).
import type { Endpoint } from './runtime.js'
export const endpoints: readonly Endpoint[] = [
  {
    name: 'search_major_requirements',
    path: '/api/v1/majors',
    description: 'Search degree-specific official OASIS change-of-major messages ',
    parameters: [
      {
        name: 'q',
        in: 'query',
        description:
          'Official English major name, major code or college. Omit to list all records.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'degree',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['AB', 'BS'],
        },
      },
    ],
  },
  {
    name: 'get_major_requirements',
    path: '/api/v1/majors/{major_code}',
    description: 'Read official messages for one major, with separate degree records ',
    parameters: [
      {
        name: 'major_code',
        in: 'path',
        required: true,
        description: 'OASIS program code, e.g. LMAT. Not a course code.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'degree',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['AB', 'BS'],
        },
      },
    ],
  },
  {
    name: 'search',
    path: '/api/v1/search',
    description: 'Search courses and professors in English or Chinese ',
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: true,
        description:
          'Unicode search text. Examples: CHE 2A, Bryan Enderle, 化学2A, 数学21A. URL-encode UTF-8 characters.',
        schema: {
          type: 'string',
          minLength: 1,
        },
      },
      {
        name: 'type',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['all', 'course', 'professor'],
          default: 'all',
        },
      },
      {
        name: 'lang',
        in: 'query',
        description:
          'Controls presentation labels, not search language. JSON property names remain English.',
        schema: {
          type: 'string',
          enum: ['en', 'zh'],
          default: 'en',
        },
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
    ],
  },
  {
    name: 'search_review_comments',
    path: '/api/v1/reviews/search',
    description:
      "Search original student review comments with FTS5 keywords or phrases Repeat term 1–10 times. professor_id and department are optional. FTS5 searches the full comment corpus; add either or both to narrow results. Matches are evidence to inspect, not semantic confirmation; 'slides' may occur in both positive and negative claims. Keep filters unchanged and pass next_cursor as cursor for the next page.",
    parameters: [
      {
        name: 'term',
        in: 'query',
        required: true,
        description:
          'Repeat for each expanded keyword or phrase; FTS5 token or phrase matching, not arbitrary substring matching; max 80 characters each.',
        schema: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
          },
          minItems: 1,
          maxItems: 10,
        },
        style: 'form',
        explode: true,
      },
      {
        name: 'professor_id',
        in: 'query',
        description: 'Optional numeric RMP professor ID.',
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'department',
        in: 'query',
        description: 'Optional exact case-insensitive RMP department label, e.g. Economics.',
        schema: {
          type: 'string',
          maxLength: 100,
        },
      },
      {
        name: 'mode',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['any', 'all'],
          default: 'any',
        },
      },
      {
        name: 'course',
        in: 'query',
        description:
          'Optional course key or equivalent formatted code. Uses inferred links while preserving course_raw.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'from',
        in: 'query',
        description: 'Inclusive UTC calendar date.',
        schema: {
          type: 'string',
          format: 'date',
        },
      },
      {
        name: 'to',
        in: 'query',
        description: 'Inclusive UTC calendar date.',
        schema: {
          type: 'string',
          format: 'date',
        },
      },
      {
        name: 'min_confidence',
        in: 'query',
        description:
          'Minimum inferred course-link confidence. Default 0 includes broad discovery matches.',
        schema: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0,
        },
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
      {
        name: 'cursor',
        in: 'query',
        description: 'Opaque next_cursor returned by the previous page.',
        schema: {
          type: 'string',
        },
      },
    ],
  },
  {
    name: 'get_course',
    path: '/api/v1/courses/{course_key}',
    description: 'Get one course by canonical key or equivalent formatted code ',
    parameters: [
      {
        name: 'course_key',
        in: 'path',
        required: true,
        description:
          'Compact course key such as CHE2A. Display forms such as CHE002A are also resolved.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'lang',
        in: 'query',
        description:
          'Controls presentation labels, not search language. JSON property names remain English.',
        schema: {
          type: 'string',
          enum: ['en', 'zh'],
          default: 'en',
        },
      },
    ],
  },
  {
    name: 'get_course_professors',
    path: '/api/v1/courses/{course_key}/professors',
    description: 'Find and rank professors with reviews linked to a course ',
    parameters: [
      {
        name: 'course_key',
        in: 'path',
        required: true,
        description:
          'Compact course key such as CHE2A. Display forms such as CHE002A are also resolved.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'lang',
        in: 'query',
        description:
          'Controls presentation labels, not search language. JSON property names remain English.',
        schema: {
          type: 'string',
          enum: ['en', 'zh'],
          default: 'en',
        },
      },
      {
        name: 'min_confidence',
        in: 'query',
        description:
          'Minimum inferred course-link confidence. Default 0 includes broad discovery matches.',
        schema: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0,
        },
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
        },
      },
      {
        name: 'sort_by',
        in: 'query',
        description:
          'active_first sorts recent reviewers first, then by overall rating. Default active_first.',
        schema: {
          type: 'string',
          enum: [
            'rating_desc',
            'rating_asc',
            'difficulty_asc',
            'difficulty_desc',
            'reviews_desc',
            'retake_desc',
            'active_first',
          ],
          default: 'active_first',
        },
      },
      {
        name: 'min_rating',
        in: 'query',
        schema: {
          type: 'number',
          minimum: 0,
          maximum: 5,
        },
      },
      {
        name: 'max_difficulty',
        in: 'query',
        schema: {
          type: 'number',
          minimum: 0,
          maximum: 5,
        },
      },
      {
        name: 'min_reviews',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 0,
        },
      },
      {
        name: 'min_take_again',
        in: 'query',
        description: 'Percentage from 0 to 100.',
        schema: {
          type: 'number',
          minimum: 0,
          maximum: 100,
        },
      },
    ],
  },
  {
    name: 'get_professor_course_stats',
    path: '/api/v1/courses/{course_key}/professors/{professor_id}/stats',
    description:
      'Get detailed descriptive statistics and yearly trend for one professor in one course One review is counted once per course, even if several link rules matched. Inferred links are included. Comparisons are descriptive and based on self-selected RMP reviewers, not all enrolled students. Recent and previous windows each span 730 days; a trend delta requires at least five rated reviews in each window. No causal or representative-sample claim is made.',
    parameters: [
      {
        name: 'course_key',
        in: 'path',
        required: true,
        description:
          'Compact course key such as CHE2A. Display forms such as CHE002A are also resolved.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'professor_id',
        in: 'path',
        required: true,
        description: 'Numeric Rate My Professors ID.',
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  {
    name: 'get_official_catalog_course',
    path: '/api/v1/catalog/courses/{course_key}',
    description:
      'Get official UC Davis catalog course title, units, description, prerequisites, and other published details Independent snapshot collected from UC Davis subject-code course pages. Exact course-key match only; malformed student-entered course labels are not silently corrected. Check fetched_at and catalog_url for current official information.',
    parameters: [
      {
        name: 'course_key',
        in: 'path',
        required: true,
        description:
          'Compact course key such as CHE2A. Display forms such as CHE002A are also resolved.',
        schema: {
          type: 'string',
        },
      },
    ],
  },
  {
    name: 'get_professor',
    path: '/api/v1/professors/{professor_id}',
    description: "Get a professor's identity and overall RMP profile metrics ",
    parameters: [
      {
        name: 'professor_id',
        in: 'path',
        required: true,
        description: 'Numeric Rate My Professors ID.',
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  {
    name: 'get_professor_courses',
    path: '/api/v1/professors/{professor_id}/courses',
    description: "Find courses linked to a professor's reviews ",
    parameters: [
      {
        name: 'professor_id',
        in: 'path',
        required: true,
        description: 'Numeric Rate My Professors ID.',
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'lang',
        in: 'query',
        description:
          'Controls presentation labels, not search language. JSON property names remain English.',
        schema: {
          type: 'string',
          enum: ['en', 'zh'],
          default: 'en',
        },
      },
      {
        name: 'min_confidence',
        in: 'query',
        description:
          'Minimum inferred course-link confidence. Default 0 includes broad discovery matches.',
        schema: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0,
        },
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
        },
      },
    ],
  },
  {
    name: 'get_professor_reviews',
    path: '/api/v1/professors/{professor_id}/reviews',
    description:
      "Read a professor's reviews, optionally filtered by course and inclusive UTC dates Keep course_raw when interpreting a course filter. course_links contains each possible normalized association, relationship, and confidence. Pass next_cursor unchanged as cursor for the next page with the same filters.",
    parameters: [
      {
        name: 'professor_id',
        in: 'path',
        required: true,
        description: 'Numeric Rate My Professors ID.',
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'course',
        in: 'query',
        description:
          'Canonical or equivalent course code, for example CHE2A, CHE002A, or CHE 002A.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'from',
        in: 'query',
        description: 'Inclusive UTC calendar date.',
        schema: {
          type: 'string',
          format: 'date',
        },
      },
      {
        name: 'to',
        in: 'query',
        description: 'Inclusive UTC calendar date.',
        schema: {
          type: 'string',
          format: 'date',
        },
      },
      {
        name: 'min_confidence',
        in: 'query',
        description:
          'Minimum inferred course-link confidence. Default 0 includes broad discovery matches.',
        schema: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0,
        },
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
        },
      },
      {
        name: 'cursor',
        in: 'query',
        description: 'Opaque next_cursor returned by the previous page.',
        schema: {
          type: 'string',
        },
      },
      {
        name: 'include_raw',
        in: 'query',
        description: 'Set to 1 to include the stored original RMP JSON record for each review.',
        schema: {
          type: 'integer',
          enum: [0, 1],
          default: 0,
        },
      },
    ],
  },
]
