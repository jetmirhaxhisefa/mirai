<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTaskRequest;
use App\Http\Requests\UpdateTaskRequest;
use App\Models\Task;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class TaskController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json($request->user()->tasks()->latest('id')->get());
    }

    public function summary(Request $request): JsonResponse
    {
        $total = $request->user()->tasks()->count();
        $done = $request->user()->tasks()->where('done', true)->count();

        return response()->json(['total' => $total, 'done' => $done, 'open' => $total - $done]);
    }

    public function store(StoreTaskRequest $request): JsonResponse
    {
        $task = $request->user()->tasks()->create($request->validated());

        return response()->json($task, 201);
    }

    public function update(UpdateTaskRequest $request, Task $task): JsonResponse
    {
        $task->title = $request->validated()['title'];
        $task->save();

        return response()->json($task);
    }

    public function complete(Task $task): JsonResponse
    {
        Gate::authorize('update', $task);
        $task->markDone();

        return response()->json($task);
    }

    public function destroy(Task $task): Response
    {
        Gate::authorize('update', $task);
        $task->delete();

        return response()->noContent();
    }
}
