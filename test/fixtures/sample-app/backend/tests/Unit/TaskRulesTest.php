<?php

namespace Tests\Unit;

use App\Http\Requests\StoreTaskRequest;
use App\Http\Requests\UpdateTaskRequest;
use App\Models\Task;
use Illuminate\Support\Facades\Validator;
use Tests\TestCase;

class TaskRulesTest extends TestCase
{
    private function passes(array $data): bool
    {
        return Validator::make($data, (new StoreTaskRequest)->rules())->passes();
    }

    public function test_a_title_is_required(): void
    {
        $this->assertFalse($this->passes([]));
        $this->assertFalse($this->passes(['title' => '']));
    }

    public function test_the_title_has_a_maximum_length(): void
    {
        $this->assertTrue($this->passes(['title' => str_repeat('a', Task::MAX_TITLE_LENGTH)]));
        $this->assertFalse($this->passes(['title' => str_repeat('a', Task::MAX_TITLE_LENGTH + 1)]));
    }

    public function test_update_rules_match_store_rules(): void
    {
        $this->assertSame((new StoreTaskRequest)->rules(), (new UpdateTaskRequest)->rules());
    }

    public function test_done_is_cast_to_a_boolean(): void
    {
        $task = new Task(['title' => 'x']);
        $task->done = 1;

        $this->assertTrue($task->done);
    }
}
